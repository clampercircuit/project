import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { after, beforeEach, test } from 'node:test';
import chat from '../api/chat.js';

const localFetch = globalThis.fetch;
const originalWebhook = process.env.WEBHOOK_URL;
beforeEach(() => { process.env.WEBHOOK_URL = 'https://workflow.example/webhook/test'; });
after(() => {
  if (originalWebhook === undefined) delete process.env.WEBHOOK_URL;
  else process.env.WEBHOOK_URL = originalWebhook;
});

async function request(options = {}, prepare = () => {}) {
  const server = http.createServer((req, res) => {
    prepare(req);
    chat(req, res).catch(() => { res.writeHead(500).end(); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await localFetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '  What is AOSP?  ' }),
      ...options,
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test('local streamed JSON forwards the trimmed question and normalizes the answer', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ answer: 'Android Open Source Project' }));
  });
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.body.answer, 'Android Open Source Project');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get('message'), 'What is AOSP?');
  assert.equal(calls[0].options.method, 'GET');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('Vercel parsed bodies and preview/custom host origins work', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('AOSP answer'));
  for (const host of ['preview.vercel.app', 'chat.example.com']) {
    const response = await request({ headers: { 'Content-Type': 'application/json', Origin: `https://${host}` } }, req => {
      req.body = { message: 'Question from Vercel' };
      req.headers.host = host;
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.answer, 'AOSP answer');
  }
});

test('cross-origin requests are rejected without invoking the webhook', async t => {
  const upstream = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected call'); });
  const response = await request({ headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' } });
  assert.equal(response.status, 403);
  assert.equal(upstream.mock.callCount(), 0);
});

test('method, content type, malformed JSON, null, and invalid messages are rejected', async t => {
  const upstream = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected call'); });
  const cases = [
    [{ method: 'GET', body: undefined }, 405],
    [{ headers: { 'Content-Type': 'text/plain' } }, 415],
    [{ body: '{broken' }, 400],
    [{ body: 'null' }, 400],
    [{ body: JSON.stringify({ message: ' ' }) }, 400],
    [{ body: JSON.stringify({ message: 'a'.repeat(4001) }) }, 400],
    [{ body: JSON.stringify({ message: 123 }) }, 400],
  ];
  for (const [options, status] of cases) {
    const response = await request(options);
    assert.equal(response.status, status);
    if (status === 405) assert.equal(response.headers.get('allow'), 'POST');
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('oversized streamed and Vercel parsed bodies are rejected', async t => {
  const upstream = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected call'); });
  const body = { message: 'Question', extra: 'a'.repeat(24_000) };
  assert.equal((await request({ body: JSON.stringify(body) })).status, 413);
  assert.equal((await request({}, req => { req.body = body; })).status, 413);
  assert.equal(upstream.mock.callCount(), 0);
});

test('malformed Vercel body getters return a readable client error', async () => {
  const response = await request({}, req => {
    Object.defineProperty(req, 'body', { get() { throw new SyntaxError('Invalid JSON'); } });
  });
  assert.equal(response.status, 400);
});

test('missing or invalid webhook configuration returns 503 without leaking its value', async t => {
  const upstream = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected call'); });
  for (const value of [undefined, 'invalid-url', 'file:///private']) {
    if (value === undefined) delete process.env.WEBHOOK_URL;
    else process.env.WEBHOOK_URL = value;
    const response = await request();
    assert.equal(response.status, 503);
    assert.match(response.body.error, /Set WEBHOOK_URL/);
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('upstream failures and empty answers return useful errors without retries', async t => {
  const upstream = t.mock.method(globalThis, 'fetch');
  upstream.mock.mockImplementation(async () => new Response('Unavailable', { status: 404 }));
  const unavailable = await request();
  assert.equal(unavailable.status, 502);
  assert.equal(unavailable.body.upstreamStatus, 404);
  upstream.mock.mockImplementation(async () => new Response(''));
  const empty = await request();
  assert.equal(empty.status, 502);
  assert.match(empty.body.error, /empty answer/);
  assert.equal(upstream.mock.callCount(), 2);
});
