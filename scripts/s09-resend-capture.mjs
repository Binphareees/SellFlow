import { setTimeout } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';

const capturePath = process.argv[2];
if (!capturePath) {
  console.error('[s09-resend-capture] capture path missing');
  process.exit(9);
}

if (!capturePath.startsWith('/tmp/')) {
  console.error('[s09-resend-capture] capture path not allowed');
  process.exit(9);
}

const server = createServer((socket) => {
  const chunks = [];
  socket.on('data', (chunk) => chunks.push(chunk));
  socket.on('error', () => {});
  socket.on('end', () => handleRequest(socket, Buffer.concat(chunks)));
});

server.on('error', (err) => {
  console.error('[s09-resend-capture] server error', err?.message ?? err);
});

server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  if (!addr || typeof addr !== 'object' || addr.port == null) {
    console.error('[s09-resend-capture] failed to obtain port');
    process.exit(8);
  }
  if (process.stdout.write(`${addr.port}\n`)) {
    // started
  } else {
    // best effort; the harness health probe will still detect readiness
  }
});

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function sanitizeHeadersForLog(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const out = {};
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'x-api-key' || lower === 'x-resend-api-key') {
      out[key] = '<redacted>';
    } else {
      out[key] = headers[key];
    }
  }
  return out;
}

async function readBody(socket, byteLength, encoding) {
  if (byteLength == null || byteLength <= 0) {
    return encoding === 'hex' ? '' : '';
  }
  const buffers = [];
  let remaining = byteLength;
  while (remaining > 0) {
    const chunk = await new Promise((resolve, reject) => {
      const handler = (buf) => {
        socket.removeListener('data', handler);
        socket.removeListener('error', reject);
        resolve(buf);
      };
      socket.on('data', handler);
      socket.on('error', reject);
    });
    if (!Buffer.isBuffer(chunk)) {
      socket.destroy();
      return '';
    }
    buffers.push(chunk);
    remaining -= chunk.length;
  }
  if (encoding === 'hex') {
    return Buffer.concat(buffers).toString('hex');
  }
  return Buffer.concat(buffers).toString('utf8');
}

function sendResponse(socket, statusCode, statusText, headers, body) {
  const reason = statusText ?? '';
  const startLine = `HTTP/1.1 ${statusCode} ${reason}\r\n`;
  let headerBlock = '';
  const headerNames = Object.keys(headers ?? {});
  for (const name of headerNames) {
    const value = headers[name];
    if (value == null) continue;
    headerBlock += `${name}: ${value}\r\n`;
  }
  headerBlock += `Content-Length: ${Buffer.byteLength(body ?? '')}\r\n`;
  socket.write(startLine + headerBlock + '\r\n' + (body ?? ''));
}

function respondBadRequest(socket, message) {
  const body = JSON.stringify({ error: { message, code: 'INVALID_REQUEST' } });
  sendResponse(socket, 400, 'Bad Request', { 'content-type': 'application/json' }, body);
  socket.end();
}

function respondNotFound(socket) {
  sendResponse(socket, 404, 'Not Found', { 'content-type': 'application/json' }, JSON.stringify({ error: { message: 'Not Found', code: 'NOT_FOUND' } }));
  socket.end();
}

function respondInternalError(socket) {
  const body = JSON.stringify({ error: { message: 'Internal Server Error', code: 'INTERNAL_ERROR' } });
  sendResponse(socket, 500, 'Internal Server Error', { 'content-type': 'application/json' }, body);
  socket.end();
}

function respondCreated(socket, id) {
  const body = JSON.stringify({ id, accepted: true, recipient: [], headers: {}, created: true });
  sendResponse(socket, 201, 'Created', {
    'content-type': 'application/json',
    'x-request-id': id,
  }, body);
  socket.end();
}

function respondHealth(socket) {
  sendResponse(socket, 200, 'OK', { 'content-type': 'application/json' }, JSON.stringify({ status: 'ok' }));
  socket.end();
}

function respondReady(socket) {
  sendResponse(socket, 200, 'OK', { 'content-type': 'application/json' }, JSON.stringify({ ready: true }));
  socket.end();
}

function appendCapture(records) {
  if (!Array.isArray(records)) return;
  let current = '';
  try {
    current = readFileSync(capturePath, 'utf8');
  } catch (_) {
    current = '';
  }
  let parsed;
  if (current.trim().length === 0) {
    parsed = [];
  } else {
    parsed = parseJsonSafely(current);
    if (!Array.isArray(parsed)) parsed = [];
  }
  for (const record of records) {
    parsed.push(record);
  }
  writeFileSync(capturePath, JSON.stringify(parsed, null, 2), 'utf8');
}

async function handleRequest(socket, raw) {
  try {
    const text = raw.toString('utf8');
    const headerEnd = text.indexOf('\r\n\r\n');
    if (headerEnd < 0) {
      respondBadRequest(socket, 'invalid http request format');
      return;
    }
    const headerText = text.slice(0, headerEnd);
    const bodyAfterHeaders = text.slice(headerEnd + 4);
    const lines = headerText.split('\r\n');
    const requestLine = lines[0] ?? '';
    const method = requestLine.split(' ')[0] ?? '';
    const path = requestLine.split(' ')[1] ?? '/';
    const headers = {};
    let contentLength = 0;
    let contentLengthSpecified = false;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.length === 0) continue;
      const colonIndex = line.indexOf(':');
      if (colonIndex < 0) continue;
      const name = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();
      if (name.toLowerCase() === 'content-length') {
        const parsed = parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          contentLength = parsed;
          contentLengthSpecified = true;
        }
      } else if (headers[name] === undefined) {
        headers[name] = value;
      }
    }
    let body = bodyAfterHeaders;
    if (contentLengthSpecified) {
      body = await readBody(socket, contentLength, 'utf8');
    }
    if (path === '/health' && method === 'GET') {
      respondHealth(socket);
      return;
    }
    if (path === '/ready' && method === 'GET') {
      respondReady(socket);
      return;
    }
    if (path !== '/emails') {
      respondNotFound(socket);
      return;
    }
    if (method !== 'POST') {
      respondBadRequest(socket, 'method not allowed');
      return;
    }
    const parsed = parseJsonSafely(body);
    if (parsed == null || typeof parsed !== 'object' || parsed === null) {
      respondBadRequest(socket, 'request body is not valid json');
      return;
    }
    const id = parsed?.id ?? randomUUID();
    const record = {
      id,
      timestamp: new Date().toISOString(),
      method,
      path,
      httpVersion: '1.1',
      headers: sanitizeHeadersForLog(headers),
      bodyText: body,
      bodyJson: parsed,
    };
    appendCapture([record]);
    respondCreated(socket, id);
  } catch (err) {
    respondInternalError(socket);
  }
}
