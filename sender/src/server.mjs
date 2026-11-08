import { timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns';
import { createServer, validateHeaderValue } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024;
const TIMEOUT_MS = 10_000;
// shortcut: special ranges follow the IANA registry reviewed on 2026-11-07; revisit when egress policy changes.
const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
]) blocked.addSubnet(address, prefix, 'ipv6');
const globalIPv6 = new BlockList();
globalIPv6.addSubnet('2000::', 3, 'ipv6');

class SenderError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}

function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, 'ipv4')
    : family === 6 && globalIPv6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['url', 'body', 'headers'].includes(key))
    || typeof input.url !== 'string' || Buffer.byteLength(input.url) > 2048
    || typeof input.body !== 'string' || Buffer.byteLength(input.body) > MAX_BODY_BYTES
    || !input.headers || typeof input.headers !== 'object' || Array.isArray(input.headers)) {
    throw new SenderError(400, 'invalid_request');
  }
  let url;
  try { url = new URL(input.url); } catch { throw new SenderError(400, 'invalid_request'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new SenderError(400, 'invalid_request');
  const requiredHeaders = ['webhook-id', 'webhook-timestamp', 'webhook-signature', 'x-mcp-subscription-id'];
  const allowedHeaders = [...requiredHeaders, 'content-type'];
  const headers = {};
  for (const [name, value] of Object.entries(input.headers)) {
    const normalized = name.toLowerCase();
    if (!allowedHeaders.includes(normalized) || Object.hasOwn(headers, normalized)) throw new SenderError(400, 'invalid_request');
    headers[normalized] = value;
  }
  if (requiredHeaders.some((name) => !headers[name])
    || Object.entries(headers).some(([name, value]) => {
      if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 4096) return true;
      try { validateHeaderValue(name, value); } catch { return true; }
      return name === 'content-type' && value !== 'application/json';
    })) throw new SenderError(400, 'invalid_request');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new SenderError(400, 'destination_blocked');
  return { url, hostname, body: Buffer.from(input.body), headers };
}

function readInput(request, signal) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let finished = false;
    const aborted = () => fail(new SenderError(504, 'callback_timeout'));
    const cleanup = () => {
      finished = true;
      signal.removeEventListener('abort', aborted);
      request.off('data', data);
      request.off('end', end);
    };
    const fail = (error) => {
      if (finished) return;
      cleanup(); request.resume(); reject(error);
    };
    const data = (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        chunks.length = 0;
        fail(new SenderError(413, 'request_too_large'));
      } else chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new SenderError(400, 'invalid_request')); }
    };
    signal.addEventListener('abort', aborted, { once: true });
    request.on('data', data);
    request.on('error', fail);
    request.on('end', end);
  });
}

function postCallback({ url, hostname, body, headers }, signal, deadline) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    let approvedAddress = isIP(hostname) ? hostname : undefined;
    const outgoing = httpsRequest({
      hostname, port: url.port || 443, path: `${url.pathname}${url.search}`, method: 'POST',
      servername: isIP(hostname) ? '' : hostname, rejectUnauthorized: true, agent: false, autoSelectFamily: false,
      maxHeaderSize: 8192, signal,
      headers: { 'content-type': 'application/json', ...headers, 'content-length': body.length },
      lookup(name, _options, callback) {
        lookup(name, { all: true, verbatim: true }, (error, addresses) => {
          if (signal.aborted || Date.now()>=deadline) return callback(new SenderError(504, 'callback_timeout'));
          if (error) return callback(error);
          if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
            return callback(new SenderError(400, 'destination_blocked'));
          }
          approvedAddress = addresses[0].address;
          callback(null, approvedAddress, addresses[0].family);
        });
      },
    }, (incoming) => {
      const chunks = [];
      let size = 0;
      incoming.on('data', (chunk) => {
        const remaining = MAX_RESPONSE_BYTES - size;
        chunks.push(chunk.subarray(0, remaining));
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          resolve({ status: incoming.statusCode, body: Buffer.concat(chunks).toString('utf8'), bodyTruncated: true });
          incoming.destroy();
        }
      });
      incoming.on('error', reject);
      incoming.on('end', () => resolve({ status: incoming.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    outgoing.on('socket', (socket) => {
      socket.once('connect', () => {
        if (socket.remoteAddress !== approvedAddress || !isPublicAddress(socket.remoteAddress)) {
          outgoing.destroy(new SenderError(400, 'destination_blocked'));
        }
      });
      socket.once('secureConnect',()=>{
        if (signal.aborted || Date.now()>=deadline) outgoing.destroy(new SenderError(504,'callback_timeout'));
        else outgoing.end(body);
      });
    });
    outgoing.on('error', reject);
  });
}

const token = process.env.CALLBACK_SENDER_TOKEN;
if (!token || Buffer.byteLength(token) < 32) throw new Error('CALLBACK_SENDER_TOKEN must contain at least 32 bytes');
const expectedAuthorization = Buffer.from(`Bearer ${token}`);

function reply(response, status, body) {
  if (status >= 400) response.shouldKeepAlive = false;
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

const server = createServer({ maxHeaderSize: 8192 }, async (request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') return reply(response, 200, { ok: true });
  const authorization = Buffer.from(request.headers.authorization ?? '');
  if (authorization.length !== expectedAuthorization.length || !timingSafeEqual(authorization, expectedAuthorization)) {
    return reply(response, 401, { error: 'unauthorized' });
  }
  if (request.method !== 'POST' || request.url !== '/send') return reply(response, 404, { error: 'not_found' });
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return reply(response, 400, { error: 'invalid_request' });
  }
  const deadlineHeader=request.headers['x-wapilot-deadline'];
  const deadline=Number(deadlineHeader);
  if (typeof deadlineHeader !== 'string' || !/^\d+$/.test(deadlineHeader) || !Number.isSafeInteger(deadline) || deadline<=0) {
    return reply(response,400,{error:'invalid_request'});
  }
  const until=Math.min(Date.now()+TIMEOUT_MS,deadline),remaining=until-Date.now();
  if (remaining<=0) return reply(response,504,{error:'callback_timeout'});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  const disconnected = () => controller.abort();
  response.once('close', disconnected);
  try {
    const input = validateInput(await readInput(request, controller.signal));
    if (Date.now()>=until) throw new SenderError(504,'callback_timeout');
    reply(response, 200, await postCallback(input, controller.signal,until));
  } catch (error) {
    if (controller.signal.aborted) reply(response, 504, { error: 'callback_timeout' });
    else reply(response, error instanceof SenderError ? error.status : 502,
      { error: error instanceof SenderError ? error.message : 'callback_failed' });
  } finally {
    clearTimeout(timer);
    response.off('close', disconnected);
  }
});

server.headersTimeout = 5000;
server.requestTimeout = TIMEOUT_MS;

server.listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? '0.0.0.0', () => {
  process.stdout.write(`WaPilot sender ready: ${server.address().port}\n`);
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => { server.closeAllConnections(); process.exit(0); }, TIMEOUT_MS + 1000).unref();
});
