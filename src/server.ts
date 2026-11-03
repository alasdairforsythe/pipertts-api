// HTTP API. POST /v1/audio/speech takes the OpenAI text-to-speech request shape, so OpenAI
// clients work by pointing their base URL at this server.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PiperTTS, UsageError, type Cast } from './engine.js';

const MAX_BODY = 10 * 1024 * 1024;

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'request body is larger than 10 MB')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}

const sendError = (res: ServerResponse, status: number, message: string) =>
  sendJson(res, status, { error: { message, type: status < 500 ? 'invalid_request_error' : 'server_error' } });

interface SpeechRequest {
  input?: unknown;
  voice?: unknown;
  speed?: unknown;
  language?: unknown;
  cast?: unknown;
  response_format?: unknown;
  model?: unknown;
}

async function speech(tts: PiperTTS, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: SpeechRequest;
  try {
    body = JSON.parse(await readBody(req)) as SpeechRequest;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'the body must be JSON, e.g. {"input": "Hello.", "voice": "Clara"}');
  }
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'the body must be a JSON object');
  if (typeof body.input !== 'string' || !body.input.trim()) throw new HttpError(400, '"input" (the text to speak) is required');
  if (body.response_format !== undefined && body.response_format !== 'flac') {
    throw new HttpError(400, `response_format "${String(body.response_format)}" is not available; the only format is "flac"`);
  }
  const r = await tts.speak({
    text: body.input,
    voice: body.voice === undefined || body.voice === null ? undefined : String(body.voice),
    speed: body.speed === undefined || body.speed === null ? undefined : Number(body.speed),
    language: body.language === undefined || body.language === null ? undefined : String(body.language),
    cast: body.cast as Cast | undefined,
  });
  res.writeHead(200, {
    'Content-Type': 'audio/flac',
    'Content-Length': r.flac.length,
    'X-Audio-Seconds': r.seconds.toFixed(3),
    'X-Segments': String(r.segments),
    ...(r.warnings.length ? { 'X-Warnings': r.warnings.join('; ') } : {}),
  });
  res.end(r.flac);
}

/** Create (not start) the HTTP server around a loaded engine. */
export function createApiServer(tts: PiperTTS): Server {
  return createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/';
    (async () => {
      if (req.method === 'POST' && (path === '/v1/audio/speech' || path === '/v1/speech')) return speech(tts, req, res);
      if (req.method === 'GET' && path === '/v1/voices') return sendJson(res, 200, { voices: tts.voices() });
      if (req.method === 'GET' && (path === '/health' || path === '/')) return sendJson(res, 200, { ok: true });
      throw new HttpError(404, 'not found. Endpoints: POST /v1/audio/speech, GET /v1/voices, GET /health');
    })().catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : e instanceof UsageError ? 400 : 500;
      const message = e instanceof Error ? e.message : String(e);
      if (res.headersSent) { res.destroy(); return; }
      sendError(res, status, message);
    });
  });
}
