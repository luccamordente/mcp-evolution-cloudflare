import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const token = 'test-only-sender-token-with-32-characters';
const suffix = `${process.pid}-${Date.now()}`;
const network = `wapilot-sender-test-${suffix}`;
const image = `wapilot-sender-test:${suffix}`;
const containers = [];
let fixtures;
let origin;
let receiverOrigin;
let senderId;

function docker(...args) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function originFor(container, port) {
  return `http://127.0.0.1:${docker('port', container, `${port}/tcp`).split(':').at(-1)}`;
}
async function ready(url) {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('test container not ready');
}
function startSender(trustCertificate = true) {
  const id = docker('run', '--detach', '--rm', '--network', network, '--dns', '93.184.216.20',
    '--publish', '127.0.0.1::8080', '--env', `CALLBACK_SENDER_TOKEN=${token}`,
    ...(trustCertificate ? ['--env', 'NODE_EXTRA_CA_CERTS=/fixtures/cert.pem'] : []),
    '--mount', `type=bind,source=${fixtures},target=/fixtures,readonly`, image);
  containers.push(id);
  return { id, origin: originFor(id, 8080) };
}

before(async () => {
  docker('build', '--tag', image, root);
  fixtures = mkdtempSync(join(tmpdir(), 'wapilot-sender-'));
  chmodSync(fixtures, 0o755);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=callback.test', '-addext', 'subjectAltName=DNS:callback.test,DNS:rebind.test,DNS:slowdns.test,DNS:deadline-dns.test,DNS:slowtls.test',
    '-keyout', join(fixtures, 'key.pem'), '-out', join(fixtures, 'cert.pem')], { stdio: 'ignore' });
  chmodSync(join(fixtures, 'key.pem'), 0o644);
  docker('network', 'create', '--subnet', '93.184.216.0/24', network);
  const receiver = docker('run', '--detach', '--rm', '--network', network, '--ip', '93.184.216.20',
    '--publish', '127.0.0.1::8081', '--mount', `type=bind,source=${fixtures},target=/fixtures,readonly`,
    '--mount', `type=bind,source=${join(root, 'test')},target=/test,readonly`, image, 'node', '/test/receiver.mjs');
  containers.push(receiver);
  receiverOrigin = originFor(receiver, 8081);
  await ready(receiverOrigin);
  const sender = startSender();
  origin = sender.origin;
  senderId = sender.id;
  await ready(`${origin}/healthz`);
}, { timeout: 120_000 });

after(() => {
  for (const id of containers.reverse()) { try { docker('rm', '--force', id); } catch {} }
  try { docker('network', 'rm', network); } catch {}
  try { docker('image', 'rm', image); } catch {}
  if (fixtures) rmSync(fixtures, { recursive: true, force: true });
});

const headers = {
  'Content-Type': 'application/json', 'webhook-id': 'evt_docker', 'webhook-timestamp': '1794090000',
  'webhook-signature': 'v1,signature1 v1,signature2', 'X-MCP-Subscription-Id': 'sub_docker',
};
async function send(url, body = '{"text":"Olá 👩🏽‍💻\\n"}', senderOrigin = origin, deadline=Date.now()+45000) {
  const response = await fetch(`${senderOrigin}/send`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json','x-wapilot-deadline':String(deadline) },
    body: JSON.stringify({ url, body, headers }),
  });
  return { status: response.status, body: await response.json() };
}
async function observed() { return (await fetch(receiverOrigin)).json(); }

test('connects to the approved IP with original TLS identity, exact body and signed headers', async () => {
  const body = '{ "type": "challenge", "text": "Olá 👩🏽‍💻\\n" }\n';
  const result = await send('https://callback.test/challenge', body);
  assert.deepEqual(result, { status: 200, body: { status: 202, body: '{"challenge":"test-challenge"}' } });
  const request = (await observed()).callbacks.at(-1);
  assert.equal(request.localAddress, '93.184.216.20');
  assert.equal(request.host, 'callback.test');
  assert.equal(request.servername, 'callback.test');
  assert.equal(request.bodyBase64, Buffer.from(body).toString('base64'));
  for (const [name, value] of Object.entries(headers)) assert.equal(request.headers[name.toLowerCase()], value);
  assert.equal(request.headers.authorization, undefined);
  assert.equal(request.headers.apikey, undefined);
  assert.equal(request.headers['x-wapilot-deadline'], undefined);
});

test('rejects private and mixed DNS answers without accessing a receiver', async () => {
  const before = (await observed()).callbacks.length;
  for (const host of ['private.test', 'mixed.test', 'ipv6.test']) {
    assert.deepEqual(await send(`https://${host}/blocked`), { status: 400, body: { error: 'destination_blocked' } });
  }
  assert.equal((await observed()).callbacks.length, before);
});

test('pins one resolved IP and rejects a rebinding answer on the next attempt', async () => {
  const before = (await observed()).callbacks.length;
  assert.equal((await send('https://rebind.test/events')).body.status, 202);
  assert.deepEqual(await send('https://rebind.test/events'), { status: 400, body: { error: 'destination_blocked' } });
  const observation = await observed();
  assert.equal(observation.callbacks.length, before + 1);
  assert.equal(observation.queries['rebind.test:1'], 2);
});

test('verifies the certificate hostname and trust chain before sending the body', async () => {
  const before = (await observed()).callbacks.length;
  assert.deepEqual(await send('https://wrong.test/events'), { status: 502, body: { error: 'callback_failed' } });
  const untrusted = startSender(false);
  await ready(`${untrusted.origin}/healthz`);
  assert.deepEqual(await send('https://callback.test/untrusted', '{}', untrusted.origin), {
    status: 502, body: { error: 'callback_failed' },
  });
  assert.equal((await observed()).callbacks.length, before);
});

test('returns redirects without following them and caps callback response content', async () => {
  const before = (await observed()).callbacks.length;
  assert.deepEqual(await send('https://callback.test/redirect'), { status: 200, body: { status: 302, body: 'redirect' } });
  const large = await send('https://callback.test/large-response');
  assert.equal(large.status, 200);
  assert.equal(large.body.status, 200);
  assert.equal(large.body.body, 'x'.repeat(16 * 1024));
  assert.equal(large.body.bodyTruncated, true);
  assert.equal((await observed()).callbacks.length, before + 2);
});

test('bounds the complete operation including time spent resolving DNS', { timeout: 25_000 }, async () => {
  for (const url of ['https://callback.test/slow', 'https://slowdns.test/slow']) {
    const started = Date.now();
    assert.deepEqual(await send(url), { status: 504, body: { error: 'callback_timeout' } });
    assert.ok(Date.now() - started < 12_000);
  }
});

test('enforces the authenticated absolute deadline locally during DNS and TLS without caller cancellation',async()=>{
  for (const host of ['deadline-dns.test','slowtls.test']) {
    const before=(await observed()).callbacks.length,started=Date.now();
    assert.deepEqual(await send(`https://${host}/after-deadline`,'{}',origin,started+200),{status:504,body:{error:'callback_timeout'}});
    assert.ok(Date.now()-started<1200);
    await new Promise(resolve=>setTimeout(resolve,1800));
    assert.equal((await observed()).callbacks.length,before);
  }
});

test('SIGTERM allows the active callback to finish and stops the sender', async () => {
  const pending = send('https://callback.test/finish-after-sigterm');
  for (let i = 0; i < 50; i++) {
    if ((await observed()).callbacks.some((request) => request.path === '/finish-after-sigterm')) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok((await observed()).callbacks.some((request) => request.path === '/finish-after-sigterm'));
  docker('kill', '--signal', 'TERM', senderId);
  assert.equal((await pending).body.status, 202);
  for (let i = 0; i < 50 && docker('ps', '-q', '--filter', `id=${senderId}`); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(docker('ps', '-q', '--filter', `id=${senderId}`), '');
});
