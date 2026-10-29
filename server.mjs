import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import chat from './api/chat.js';
import health from './api/health.js';
import { securityHeaders, sendJson } from './lib/http.js';

const publicDirectory = path.resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const port = Number(process.env.PORT || 3000);
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

if (!process.env.WEBHOOK_URL) console.warn('WEBHOOK_URL is missing. Set it in .env to enable chat.');

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${port}`);
    securityHeaders(response);
    if (url.pathname === '/api/health') {
      health(request, response);
      return;
    }
    if (url.pathname === '/api/chat') {
      await chat(request, response);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filename = path.resolve(publicDirectory, '.' + requested);
    if (!filename.startsWith(publicDirectory + path.sep)) { response.writeHead(403).end(); return; }
    try {
      const bytes = await readFile(filename);
      response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); }
  } catch { if (!response.headersSent) sendJson(response, 500, { error: 'Something went wrong. Please try again.' }); }
});

server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Set PORT to another port.` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`\n  BLAZE / AOSP\n  Local: http://localhost:${port}\n  Webhook configuration loaded from WEBHOOK_URL.\n`));
