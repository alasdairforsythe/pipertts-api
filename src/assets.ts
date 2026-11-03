// Everything the engine needs besides this package's own code, downloaded on first use into
// the cache folder:
//   models/   pipertts_fp16.onnx (+ models.json) from Hugging Face, checked against its SHA-256
//   g2p/      the phonemizer (g2p.js, g2p_wasm.js, g2p_wasm.wasm) from pipertts.com
//   voices/   voices.json, gains.json and each voice file the first time it is used, from pipertts.com
// Downloads honour HTTPS_PROXY / HTTP_PROXY / NO_PROXY, so they work behind sandbox proxies.

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MODEL_BASE_URL = 'https://huggingface.co/alasdairforsythe/pipertts/resolve/main/';
export const MODEL_ID = 'fp16';
const DEFAULT_ASSETS_URL = 'https://pipertts.com/app/';
const G2P_FILES = ['g2p.js', 'g2p_wasm.js', 'g2p_wasm.wasm'];
const ATTEMPTS = 3;
const MAX_REDIRECTS = 5;
const IDLE_TIMEOUT_MS = 60_000;
const USER_AGENT = 'pipertts-api';

export type Log = (line: string) => void;

/** Where downloads are kept: PIPERTTS_CACHE, else the platform's cache folder. */
export function cacheDir(): string {
  const env = process.env.PIPERTTS_CACHE;
  if (env) return env;
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'pipertts');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'pipertts');
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'pipertts');
}

/** Base URL of the phonemizer and voices (folders g2p/ and voices/ below it). */
function assetsUrl(): string {
  const u = process.env.PIPERTTS_ASSETS_URL || DEFAULT_ASSETS_URL;
  return u.endsWith('/') ? u : u + '/';
}

const exists = (p: string) => stat(p).then(() => true, () => false);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const mb = (n: number) => `${(n / 1e6).toFixed(0)} MB`;

class HttpError extends Error {
  constructor(readonly status: number, url: string) { super(`HTTP ${status} for ${url}`); }
}

async function attempt<T>(what: string, f: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < ATTEMPTS; i++) {
    if (i) await sleep(1000 * i);
    try {
      return await f();
    } catch (e) {
      last = e;
      if (e instanceof HttpError && e.status < 500) break; // the file is not there
    }
  }
  const msg = last instanceof Error ? (last.cause instanceof Error ? `${last.message}: ${last.cause.message}` : last.message) : String(last);
  throw new Error(`could not download ${what} (${msg}). This needs internet access to huggingface.co, *.hf.co and pipertts.com the first time.`);
}

/** The proxy for `url` from HTTPS_PROXY / HTTP_PROXY (either case), unless NO_PROXY excludes it. */
function proxyFor(url: URL): URL | null {
  const e = process.env;
  const raw = url.protocol === 'https:' ? e.HTTPS_PROXY || e.https_proxy || e.HTTP_PROXY || e.http_proxy : e.HTTP_PROXY || e.http_proxy;
  if (!raw) return null;
  const host = url.hostname.toLowerCase();
  for (const item of (e.NO_PROXY || e.no_proxy || '').split(/[\s,]+/)) {
    const entry = item.trim().toLowerCase().replace(/:\d+$/, '').replace(/^\*/, '');
    if (!entry) continue;
    if (entry === '*' || host === entry.replace(/^\./, '') || host.endsWith(entry.startsWith('.') ? entry : '.' + entry)) return null;
  }
  return new URL(raw.includes('://') ? raw : 'http://' + raw);
}

function proxyAuth(proxy: URL): Record<string, string> {
  if (!proxy.username) return {};
  const cred = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return { 'Proxy-Authorization': 'Basic ' + Buffer.from(cred).toString('base64') };
}

/** One GET without following redirects, through the proxy when one is configured. */
function request(url: URL): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': USER_AGENT, Accept: '*/*' };
    const send = (req: http.ClientRequest) => {
      req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new Error('no response for 60 s')));
      req.on('response', resolve);
      req.on('error', reject);
      req.end();
    };
    const proxy = proxyFor(url);
    const via = proxy ? (proxy.protocol === 'https:' ? https : http) : null;
    const proxyPort = proxy ? Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80) : 0;
    if (!proxy || !via) {
      send((url.protocol === 'https:' ? https : http).request(url, { headers }));
    } else if (url.protocol === 'http:') {
      send(via.request({ host: proxy.hostname, port: proxyPort, path: url.href, headers: { ...headers, Host: url.host, ...proxyAuth(proxy) } }));
    } else {
      // HTTPS through the proxy: a CONNECT tunnel, then TLS to the real host inside it
      const target = `${url.hostname}:${Number(url.port) || 443}`;
      const connect = via.request({ host: proxy.hostname, port: proxyPort, method: 'CONNECT', path: target, headers: { Host: target, ...proxyAuth(proxy) } });
      connect.setTimeout(IDLE_TIMEOUT_MS, () => connect.destroy(new Error('proxy did not answer for 60 s')));
      connect.on('error', reject);
      connect.on('connect', (res, socket) => {
        if (res.statusCode !== 200) { socket.destroy(); reject(new Error(`proxy refused the connection (HTTP ${res.statusCode})`)); return; }
        const secure = tls.connect({ socket, servername: url.hostname });
        send(https.request(url, { headers, createConnection: () => secure }));
      });
      connect.end();
    }
  });
}

/** GET with redirects; resolves with a 2xx response whose body has not been read yet. */
async function get(url: string): Promise<http.IncomingMessage> {
  let u = new URL(url);
  for (let i = 0; ; i++) {
    const res = await request(u);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location && i < MAX_REDIRECTS) {
      res.resume();
      u = new URL(res.headers.location, u);
      continue;
    }
    if (status < 200 || status >= 300) { res.resume(); throw new HttpError(status, url); }
    return res;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  return attempt(url, async () => {
    const res = await get(url);
    const chunks: Buffer[] = [];
    for await (const c of res) chunks.push(c as Buffer);
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  });
}

/**
 * Download `url` to `dest` through a temporary file (a cut-off download never lands in the
 * cache). With `sha256`, the file must match it.
 */
async function download(url: string, dest: string, what: string, log: Log, sha256?: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.part-${process.pid}`;
  await attempt(what, async () => {
    const res = await get(url);
    const total = Number(res.headers['content-length']) || 0;
    const report = total > 5e6;
    if (report) log(`Downloading ${what} (${mb(total)})...`);
    const hash = createHash('sha256');
    const out = createWriteStream(tmp);
    let got = 0, nextPct = 25;
    try {
      for await (const chunk of res as AsyncIterable<Buffer>) {
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise<void>((res) => out.once('drain', () => res()));
        got += chunk.length;
        if (report && total && (got / total) * 100 >= nextPct && nextPct < 100) {
          log(`  ${what}: ${nextPct}%`);
          nextPct += 25;
        }
      }
      await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
    } catch (e) {
      res.destroy();
      out.destroy();
      await rm(tmp, { force: true });
      throw e;
    }
    if (total && got !== total) { await rm(tmp, { force: true }); throw new Error(`${what}: got ${got} of ${total} bytes`); }
    const digest = hash.digest('hex');
    if (sha256 && digest !== sha256) { await rm(tmp, { force: true }); throw new HttpError(400, `${url} (checksum mismatch)`); }
    await rename(tmp, dest);
  });
}

interface ModelEntry { id: string; file: string; bytes: number; sha256: string }

export interface AssetPaths {
  modelPath: string;
  /** file: URL of g2p.js */
  g2pUrl: string;
  voicesDir: string;
}

/**
 * Make sure the model, the phonemizer and the voice lists are in the cache folder, downloading
 * what is missing. With `refresh`, everything is checked against the servers again and changed
 * files are replaced (the `download` command).
 */
export async function ensureAssets(log: Log, refresh = false): Promise<AssetPaths> {
  const root = cacheDir();
  const modelsDir = join(root, 'models'), g2pDir = join(root, 'g2p'), voicesDir = join(root, 'voices');
  const base = assetsUrl();

  // model: the manifest names the file and its checksum; a `.sha256` file next to the model
  // records what the model was verified against
  const manifestPath = join(modelsDir, 'models.json');
  if (refresh || !(await exists(manifestPath))) {
    const m = await fetchJson<{ models: ModelEntry[] }>(MODEL_BASE_URL + 'models.json');
    await mkdir(modelsDir, { recursive: true });
    await writeFile(manifestPath, JSON.stringify(m, null, 1));
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { models: ModelEntry[] };
  const entry = manifest.models.find((m) => m.id === MODEL_ID);
  if (!entry) throw new Error(`models.json has no ${MODEL_ID} model`);
  const modelPath = join(modelsDir, entry.file);
  const stampPath = modelPath + '.sha256';
  const stamp = (await exists(stampPath)) ? (await readFile(stampPath, 'utf8')).trim() : '';
  if (stamp !== entry.sha256 || !(await exists(modelPath))) {
    await download(MODEL_BASE_URL + entry.file, modelPath, 'voice model', log, entry.sha256);
    await writeFile(stampPath, entry.sha256);
  }

  // phonemizer: ES modules, so the folder gets a package.json that says so
  await mkdir(g2pDir, { recursive: true });
  await writeFile(join(g2pDir, 'package.json'), '{ "type": "module" }\n');
  for (const f of G2P_FILES) {
    const p = join(g2pDir, f);
    if (refresh || !(await exists(p))) await download(base + 'g2p/' + f, p, `phonemizer (${f})`, log);
  }

  // voices: the lists now, the voice files on demand (voiceFile)
  for (const f of ['voices.json', 'gains.json']) {
    const p = join(voicesDir, f);
    if (refresh || !(await exists(p))) await download(base + 'voices/' + f, p, f, log);
  }

  return { modelPath, g2pUrl: pathToFileURL(join(g2pDir, 'g2p.js')).href, voicesDir };
}

/** Bytes of one voice file, downloaded the first time it is needed. */
export async function voiceFile(voicesDir: string, file: string, log: Log, refresh = false): Promise<ArrayBuffer> {
  const p = join(voicesDir, file);
  if (refresh || !(await exists(p))) await download(assetsUrl() + 'voices/' + file, p, `voice ${file}`, log);
  const b = await readFile(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
