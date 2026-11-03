// The engine: text (plain or a [Character] script) -> FLAC bytes, with the same text
// handling, phonemizer, voices, model and slicing as the PiperTTS web app.
import { availableParallelism, cpus } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as ort from 'onnxruntime-web';
import { ensureAssets, voiceFile } from './assets.js';
import { FlacEncoder } from './core/flac.js';
import { collectCharacters, normalizeCharacterName, parseChapter } from './core/parse.js';
import { Phonemizer } from './core/phonemize.js';
import { prepareSegment } from './core/prepare.js';
import { concatAudio, sliceAndShape } from './core/slicing.js';
import { GAP_SECONDS, PAUSE_SECONDS, SAMPLE_RATE } from './core/types.js';
import { checkModelOutput, checkSegmentAudio } from './core/validate.js';
import { VoiceBank } from './core/voices.js';
/** Book languages: drive phonemization and the accent blend. */
export const LANGUAGES = Object.freeze({ en: 0, fr: 1, es: 2, it: 3, pt: 4, hi: 5, zh: 6 });
const DEFAULT_VOICE_NAMES = ['King', 'Delphine (French)', 'Clara', 'Riccardo (Italian)', 'Gabriel (Brazilian)', 'Rajesh (Indian)', 'Mei (East Asian)'];
export const SPEED_MIN = 0.5, SPEED_MAX = 2;
/** Clipping is reported when more than this fraction of the samples clipped (the web app's threshold). */
const CLIP_WARN_RATIO = 0.001;
const silence = (seconds) => new Float32Array(Math.round(seconds * SAMPLE_RATE));
export class PiperTTS {
    session;
    phonemizer;
    bank;
    encoder;
    threads;
    /** Requests run one at a time on the single model session. */
    queue = Promise.resolve();
    constructor(session, phonemizer, bank, encoder, threads) {
        this.session = session;
        this.phonemizer = phonemizer;
        this.bank = bank;
        this.encoder = encoder;
        this.threads = threads;
    }
    /** Download what is missing (first run only) and load the model. */
    static async load(opts = {}) {
        const log = opts.log ?? (() => { });
        const paths = await ensureAssets(log);
        const [manifest, gains] = await Promise.all([
            readFile(join(paths.voicesDir, 'voices.json'), 'utf8').then((s) => JSON.parse(s)),
            readFile(join(paths.voicesDir, 'gains.json'), 'utf8').then((s) => JSON.parse(s)),
        ]);
        const bank = new VoiceBank(manifest, gains, (file) => voiceFile(paths.voicesDir, file, log));
        const phonemizer = await Phonemizer.load(paths.g2pUrl);
        const cores = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
        const threads = Math.max(1, Math.min(opts.threads ?? cores, 8));
        ort.env.wasm.numThreads = threads;
        ort.env.logLevel = 'error';
        const session = await ort.InferenceSession.create(await readFile(paths.modelPath), {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
        });
        const names = session.inputNames.join();
        if (names !== 'tokens,style,speed')
            throw new Error(`unexpected model inputs: ${names}`);
        return new PiperTTS(session, phonemizer, bank, await FlacEncoder.create(), threads);
    }
    /**
     * Download or refresh everything, including every voice, so later runs work offline.
     * Returns the cache folder's voice count.
     */
    static async download(log) {
        const paths = await ensureAssets(log, true);
        const manifest = JSON.parse(await readFile(join(paths.voicesDir, 'voices.json'), 'utf8'));
        const files = Object.values(manifest.voices).map((v) => v.file);
        log(`Downloading ${files.length} voices...`);
        for (const f of files)
            await voiceFile(paths.voicesDir, f, log, true);
        return files.length;
    }
    /** The voices that can be used by name, grouped as in the web app. */
    voices() {
        const out = [];
        for (const g of this.bank.manifest.groups) {
            for (const { id } of g.voices) {
                const v = this.bank.manifest.voices[id];
                if (!v || !v.listed || out.some((o) => o.id === id))
                    continue;
                out.push({ name: v.name, id, accent: v.accent === 'b' ? 'British' : 'American', gender: v.gender === 'm' ? 'male' : 'female', group: g.name });
            }
        }
        return out;
    }
    /** "Clara", "clara", "Gabriel", "12" or "Clara+Sophia" -> voice ids. */
    resolveVoice(spec) {
        const ids = [];
        for (const raw of String(spec).split('+')) {
            const want = raw.trim().toLowerCase();
            if (!want)
                continue;
            const match = Object.entries(this.bank.manifest.voices).find(([id, v]) => v.listed && (id === want || v.name.toLowerCase() === want || v.name.toLowerCase().replace(/\s*\(.*\)$/, '') === want));
            if (!match)
                throw new UsageError(`unknown voice "${raw.trim()}". Run "pipertts voices" (or GET /v1/voices) for the list.`);
            ids.push(Number(match[0]));
        }
        if (ids.length === 0)
            throw new UsageError('empty voice name');
        return ids;
    }
    /** Speak `text` and return one FLAC file. Calls are queued; one runs at a time. */
    speak(opts) {
        const run = this.queue.then(() => this.run(opts));
        this.queue = run.catch(() => { });
        return run;
    }
    async run(opts) {
        const text = String(opts.text ?? '').replace(/\r\n?/g, '\n');
        if (!text.trim())
            throw new UsageError('no text to speak');
        const lang = opts.language === undefined ? 0 : LANGUAGES[String(opts.language).toLowerCase()];
        if (lang === undefined)
            throw new UsageError(`unknown language "${opts.language}". Use one of: ${Object.keys(LANGUAGES).join(', ')}.`);
        const characters = this.characters(text, opts);
        const warnings = [];
        const segs = parseChapter(text, characters, lang);
        const spoken = segs.filter((s) => s.type === 'text' && !s.displayOnly);
        if (spoken.some((s) => s.type === 'text' && s.spec.filter !== 0))
            warnings.push('effect tags such as <reverb> are not supported here and were ignored');
        const parts = [];
        let done = 0;
        for (const s of segs) {
            if (s.type === 'invisible')
                continue;
            if (s.type === 'pause') {
                parts.push(silence(PAUSE_SECONDS));
                continue;
            }
            if (s.displayOnly) {
                if (s.gaps)
                    parts.push(silence(s.gaps * GAP_SECONDS));
                continue;
            }
            const audio = await this.segment({ ...s.spec, filter: 0 });
            parts.push(audio ?? silence(PAUSE_SECONDS)); // nothing to say (only punctuation): a pause
            if (s.gaps)
                parts.push(silence(s.gaps * GAP_SECONDS));
            opts.onProgress?.(++done, spoken.length);
        }
        const audio = concatAudio(parts.length ? parts : [new Float32Array(0)]);
        if (audio.length === 0)
            throw new UsageError('nothing to speak in the text');
        const r = this.encoder.encode(audio, SAMPLE_RATE);
        if (r.clipped > audio.length * CLIP_WARN_RATIO)
            warnings.push(`${r.clipped} samples were louder than full scale and were clipped`);
        return { flac: r.bytes, seconds: audio.length / SAMPLE_RATE, segments: spoken.length, warnings };
    }
    /** One text segment through the model; null when it has nothing to say. */
    async segment(spec) {
        const { items } = await prepareSegment(spec, this.phonemizer, this.bank);
        if (items.length === 0)
            return null;
        const speed = new ort.Tensor('float32', new Float32Array([spec.speedPct / 100]), [1]);
        const parts = [];
        for (const item of items) {
            const n = item.ids.length;
            const tokens = new BigInt64Array(n);
            for (let i = 0; i < n; i++)
                tokens[i] = BigInt(item.ids[i]);
            const out = await this.session.run({
                tokens: new ort.Tensor('int64', tokens, [n]),
                style: new ort.Tensor('float32', item.style, [256]),
                speed,
            });
            const audio = out.audio.data;
            const durations = out.durations.data;
            checkModelOutput(audio, durations, n);
            parts.push(sliceAndShape(audio, durations, item));
        }
        const audio = concatAudio(parts);
        checkSegmentAudio(audio);
        return audio;
    }
    /** Cast + narrator voice + speed -> the web app's character settings (speeds x100). */
    characters(text, opts) {
        const pct = (speed, what) => {
            const s = Number(speed);
            if (!Number.isFinite(s) || s < SPEED_MIN || s > SPEED_MAX)
                throw new UsageError(`${what} must be a number from ${SPEED_MIN} to ${SPEED_MAX}`);
            return Math.round(s * 100);
        };
        const defaultPct = opts.speed === undefined ? 100 : pct(opts.speed, 'speed');
        const byKey = new Map();
        if (opts.cast !== undefined && (typeof opts.cast !== 'object' || opts.cast === null || Array.isArray(opts.cast))) {
            throw new UsageError('cast must be an object like {"Narrator": "Clara", "Anna": "Lily"}');
        }
        for (const [name, entry] of Object.entries(opts.cast ?? {})) {
            const e = typeof entry === 'string' ? { voice: entry } : entry ?? {};
            const voiceIds = e.voice ? this.resolveVoice(e.voice) : [];
            const speed = e.speed === undefined ? defaultPct : pct(e.speed, `speed of "${name}"`);
            byKey.set(normalizeCharacterName(name), { name, voiceIds, speed });
        }
        if (opts.voice !== undefined) {
            const n = byKey.get('narrator');
            byKey.set('narrator', { name: 'Narrator', voiceIds: this.resolveVoice(opts.voice), speed: n?.speed ?? defaultPct });
        }
        // characters left out of the cast speak with the narrator's voice at the default speed
        for (const name of collectCharacters(text)) {
            const key = normalizeCharacterName(name);
            if (!byKey.has(key))
                byKey.set(key, { name, voiceIds: [], speed: defaultPct });
        }
        const out = {};
        for (const c of byKey.values())
            out[c.name] = { voiceIds: c.voiceIds, speed: c.speed };
        return out;
    }
    /** Name of the voice used when no voice is given, per language. */
    static defaultVoice(language = 'en') {
        return DEFAULT_VOICE_NAMES[LANGUAGES[language] ?? 0];
    }
}
/** A problem with the request (bad voice, speed, language, empty text), not with the engine. */
export class UsageError extends Error {
    constructor(message) { super(message); this.name = 'UsageError'; }
}
