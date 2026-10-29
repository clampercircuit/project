import { securityHeaders, sendJson } from '../lib/http.js';

export default function health(request, response) {
  securityHeaders(response);
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    sendJson(response, 405, { error: 'Use GET to check health.' });
    return;
  }
  sendJson(response, 200, { status: 'ok' });
}
