import { extractAnswer } from '../response.mjs';
import { securityHeaders, sendJson } from '../lib/http.js';

export default async function chat(request, response) {
  securityHeaders(response);
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, { error: 'Use POST to send a question.' });
    return;
  }
  const origin = request.headers.origin;
  if (origin) {
    let sameOrigin = false;
    try {
      const parsed = new URL(origin);
      sameOrigin = ['http:', 'https:'].includes(parsed.protocol) && parsed.host === request.headers.host;
    } catch { /* Invalid origins are rejected below. */ }
    if (!sameOrigin) {
      sendJson(response, 403, { error: 'This endpoint only accepts requests from the chat app.' });
      return;
    }
  }
  if (!request.headers['content-type']?.includes('application/json')) {
    sendJson(response, 415, { error: 'Please send your message as JSON.' });
    return;
  }
  let message;
  try {
    let raw = '';
    // Vercel supplies a parsed body; the local Node server supplies a stream.
    const parsedBody = request.body;
    if (parsedBody !== undefined) {
      raw = typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody);
    } else {
      for await (const chunk of request) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 24_000) break;
      }
    }
    if (Buffer.byteLength(raw) > 24_000) {
      sendJson(response, 413, { error: 'That message is too long. Please keep it under 4,000 characters.' });
      return;
    }
    message = JSON.parse(raw)?.message;
  } catch {
    sendJson(response, 400, { error: 'The message could not be read. Please try again.' });
    return;
  }
  if (typeof message !== 'string' || !message.trim() || message.length > 4000) {
    sendJson(response, 400, { error: 'Enter a question between 1 and 4,000 characters.' });
    return;
  }
  let target;
  try {
    target = new URL(process.env.WEBHOOK_URL);
    if (!['https:', 'http:'].includes(target.protocol)) throw new Error('Invalid webhook protocol');
  } catch {
    sendJson(response, 503, { error: 'The chat server is not configured. Set WEBHOOK_URL in the server environment.' });
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 85_000);
  response.on('close', () => { if (!response.writableEnded) controller.abort(); });
  const started = Date.now();
  try {
    target.searchParams.set('message', message.trim());
    const upstream = await fetch(target, { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json, text/plain' } });
    const payload = await upstream.text();
    if (!upstream.ok) {
      const error = upstream.status === 404
        ? 'The workflow is unavailable. Make sure your n8n workflow is published and the production webhook is active.'
        : upstream.status === 429
          ? 'The assistant is receiving too many requests. Please wait a moment and try again.'
          : 'The n8n workflow returned an error. Check its latest execution, then try again.';
      sendJson(response, 502, { error, upstreamStatus: upstream.status });
      return;
    }
    const result = extractAnswer(payload);
    if (!result.answer) {
      sendJson(response, 502, { error: 'The workflow returned an empty answer. Check the response expression in your n8n Respond to Webhook node.' });
      return;
    }
    sendJson(response, 200, { ...result, elapsedMs: Date.now() - started });
  } catch (error) {
    if (!response.destroyed) sendJson(response, 502, { error: controller.signal.aborted
      ? 'The answer is taking longer than expected. Check the n8n execution before retrying.'
      : error.message.startsWith('The assistant') ? error.message : 'Could not reach the workflow. Check your internet connection and try again.' });
  } finally { clearTimeout(timeout); }
}
