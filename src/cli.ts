#!/usr/bin/env node
// pipertts say | voices | download | serve | help

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cacheDir } from './assets.js';
import { LANGUAGES, PiperTTS, UsageError, type Cast } from './engine.js';
import { createApiServer } from './server.js';

const HELP = `PiperTTS: text to speech. Writes FLAC (24 kHz, mono, 24-bit).

Usage:
  pipertts say "Text to speak." [-o speech.flac] [--voice NAME] [--speed 1.0]
  pipertts say --file script.txt --cast cast.json -o chapter.flac
  echo "Text" | pipertts say -o speech.flac
  pipertts voices [--json]
  pipertts serve [--port 8880] [--host 127.0.0.1]
  pipertts download

say options:
  -o, --output FILE    output file (default speech.flac)
  -f, --file FILE      read the text from a file (otherwise the arguments, or stdin)
  -v, --voice NAME     narrator voice, e.g. Clara; blend voices with +, e.g. "Clara+Lily"
  -s, --speed N        0.5 to 2.0 (default 1.0)
  -l, --lang CODE      ${Object.keys(LANGUAGES).join(', ')} (default en)
  -c, --cast JSON      voices for [Name] characters: a JSON file or inline JSON,
                       e.g. '{"Narrator": "Clara", "Anna": "Lily", "Ben": {"voice": "Adam", "speed": 1.1}}'
      --json           print the result as JSON
  -t, --threads N      CPU threads (default: cores, at most 8)

The first run downloads about 200 MB into ${cacheDir()} (PIPERTTS_CACHE changes it).`;

const log = (line: string) => process.stderr.write(line + '\n');

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function parseCast(arg: string | undefined): Promise<Cast | undefined> {
  if (arg === undefined) return undefined;
  const src = arg.trim().startsWith('{') ? arg : await readFile(arg, 'utf8');
  try {
    return JSON.parse(src) as Cast;
  } catch {
    throw new UsageError(`--cast is not valid JSON: ${arg.length > 80 ? arg.slice(0, 80) + '...' : arg}`);
  }
}

function threadsOf(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new UsageError('--threads must be a whole number of 1 or more');
  return n;
}

async function say(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o', default: 'speech.flac' },
      file: { type: 'string', short: 'f' },
      voice: { type: 'string', short: 'v' },
      speed: { type: 'string', short: 's' },
      lang: { type: 'string', short: 'l' },
      cast: { type: 'string', short: 'c' },
      json: { type: 'boolean', default: false },
      threads: { type: 'string', short: 't' },
    },
  });
  let text = positionals.join(' ');
  if (values.file !== undefined) {
    if (text) throw new UsageError('give the text either as arguments or with --file, not both');
    text = await readFile(values.file, 'utf8');
  }
  if (!text) text = await readStdin();
  if (!text.trim()) throw new UsageError('no text given. Example: pipertts say "Hello there." -o hello.flac');
  const cast = await parseCast(values.cast);

  const tts = await PiperTTS.load({ threads: threadsOf(values.threads), log });
  const r = await tts.speak({
    text,
    voice: values.voice,
    speed: values.speed === undefined ? undefined : Number(values.speed),
    language: values.lang,
    cast,
    onProgress: (done, total) => { if (total > 1) log(`Spoke segment ${done} of ${total}`); },
  });
  const out = resolve(values.output!);
  await writeFile(out, r.flac);
  for (const w of r.warnings) log(`Warning: ${w}`);
  if (values.json) {
    process.stdout.write(JSON.stringify({ file: out, seconds: Number(r.seconds.toFixed(3)), segments: r.segments, warnings: r.warnings }) + '\n');
  } else {
    process.stdout.write(`Wrote ${out} (${r.seconds.toFixed(1)} s of audio)\n`);
  }
}

async function voices(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean', default: false } } });
  const tts = await PiperTTS.load({ log, threads: 1 });
  const list = tts.voices();
  if (values.json) { process.stdout.write(JSON.stringify(list, null, 1) + '\n'); return; }
  let group = '';
  for (const v of list) {
    if (v.group !== group) { group = v.group; process.stdout.write(`\n${group}\n`); }
    process.stdout.write(`  ${v.name.padEnd(22)} ${v.accent} ${v.gender}\n`);
  }
  process.stdout.write(`\nDefault voice (English): ${PiperTTS.defaultVoice('en')}\n`);
}

async function serve(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: 'string', short: 'p', default: process.env.PORT || '8880' },
      host: { type: 'string', default: '127.0.0.1' },
      threads: { type: 'string', short: 't' },
    },
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError('--port must be a port number');
  const tts = await PiperTTS.load({ threads: threadsOf(values.threads), log });
  const server = createApiServer(tts);
  await new Promise<void>((res, rej) => { server.once('error', rej); server.listen(port, values.host, () => res()); });
  const addr = server.address();
  const shown = typeof addr === 'object' && addr ? `${values.host}:${addr.port}` : `${values.host}:${port}`;
  log(`PiperTTS server listening on http://${shown} (POST /v1/audio/speech, GET /v1/voices). Ctrl+C stops it.`);
}

async function download(): Promise<void> {
  const n = await PiperTTS.download(log);
  process.stdout.write(`Everything is downloaded (${n} voices) in ${cacheDir()}\n`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'say': await say(rest); break;
    case 'voices': await voices(rest); break;
    case 'serve': await serve(rest); break; // keeps running
    case 'download': await download(); break;
    case undefined: case 'help': case '-h': case '--help': process.stdout.write(HELP + '\n'); break;
    default: throw new UsageError(`unknown command "${cmd}". Run "pipertts help".`);
  }
}

main().catch((e: unknown) => {
  const usage = e instanceof UsageError || (e instanceof TypeError && 'code' in e && String(e.code).startsWith('ERR_PARSE_ARGS'));
  process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(usage ? 2 : 1);
});
