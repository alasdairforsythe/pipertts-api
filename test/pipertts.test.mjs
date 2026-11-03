// End-to-end tests: real model, real phonemizer, real voices (downloaded on the first run).
// Run with: npm test

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createApiServer, PiperTTS, UsageError } from '../dist/index.js';
import { decodeFlac } from '../dist/core/flac.js';

/** @type {PiperTTS} */
let tts;
before(async () => { tts = await PiperTTS.load({ log: (l) => process.stderr.write(l + '\n') }); });

const isFlac = (b) => b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43; // "fLaC"

test('plain text becomes one 24 kHz 24-bit FLAC with speech in it', async () => {
  const r = await tts.speak({ text: 'Hello there, this is a test.' });
  assert.ok(isFlac(r.flac));
  assert.equal(r.segments, 1);
  const { samples, sampleRate, bits } = await decodeFlac(r.flac);
  assert.equal(sampleRate, 24000);
  assert.equal(bits, 24);
  assert.ok(Math.abs(samples.length / 24000 - r.seconds) < 1e-6);
  assert.ok(r.seconds > 1 && r.seconds < 6, `duration ${r.seconds}`);
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  assert.ok(peak > 0.1, `peak ${peak}`);
});

test('a script with a cast speaks every line', async () => {
  const text = 'It was late.\n[Anna] Who is there?\n[Ben] Only me. ((he said)) Come in.\n[Anna]<reverb> Thanks.';
  const r = await tts.speak({ text, cast: { Narrator: 'Clara', Anna: { voice: 'Lily', speed: 1.1 }, Ben: 'Adam+Mark' } });
  assert.equal(r.segments, 5);
  assert.deepEqual(r.warnings, ['effect tags such as <reverb> are not supported here and were ignored']);
});

test('a blank line adds 0.25 s and each _ adds 0.25 s', async () => {
  const base = await tts.speak({ text: 'Hello there.\nHow are you?' });
  const blank = await tts.speak({ text: 'Hello there.\n\nHow are you?' });
  const gaps = await tts.speak({ text: 'Hello there.\nHow are you? __' });
  assert.ok(Math.abs(blank.seconds - base.seconds - 0.25) < 1e-6, `${blank.seconds} vs ${base.seconds}`);
  assert.ok(Math.abs(gaps.seconds - base.seconds - 0.5) < 1e-6, `${gaps.seconds} vs ${base.seconds}`);
});

test('speed changes the length', async () => {
  const slow = await tts.speak({ text: 'The quick brown fox jumps over the lazy dog.', voice: 'Sophia', speed: 0.8 });
  const fast = await tts.speak({ text: 'The quick brown fox jumps over the lazy dog.', voice: 'Sophia', speed: 1.5 });
  assert.ok(slow.seconds > fast.seconds * 1.3, `${slow.seconds} vs ${fast.seconds}`);
});

test('voices resolve by name, short name, id and blend', () => {
  assert.deepEqual(tts.resolveVoice('Clara'), [10]);
  assert.deepEqual(tts.resolveVoice('gabriel'), [29]);
  assert.deepEqual(tts.resolveVoice('11'), [11]);
  assert.deepEqual(tts.resolveVoice('Clara + Lily'), [10, 12]);
  assert.ok(tts.voices().length >= 40);
  assert.throws(() => tts.resolveVoice('alloy'), UsageError);
});

test('bad requests are UsageErrors', async () => {
  await assert.rejects(tts.speak({ text: '   ' }), UsageError);
  await assert.rejects(tts.speak({ text: 'Hi.', speed: 3 }), UsageError);
  await assert.rejects(tts.speak({ text: 'Hi.', language: 'jp' }), UsageError);
  await assert.rejects(tts.speak({ text: 'Hi.', voice: 'Nobody' }), UsageError);
});

test('HTTP: POST /v1/audio/speech returns FLAC, errors are JSON', async (t) => {
  const server = createApiServer(tts);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;

  const ok = await fetch(url + '/v1/audio/speech', { method: 'POST', body: JSON.stringify({ model: 'x', input: 'Hello.', voice: 'Emily' }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'audio/flac');
  assert.ok(isFlac(new Uint8Array(await ok.arrayBuffer())));

  const bad = await fetch(url + '/v1/audio/speech', { method: 'POST', body: JSON.stringify({ input: 'Hello.', response_format: 'mp3' }) });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error.message, /flac/);

  const voices = await (await fetch(url + '/v1/voices')).json();
  assert.ok(voices.voices.some((v) => v.name === 'Clara'));
});
