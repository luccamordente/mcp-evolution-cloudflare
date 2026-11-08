import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, after, test } from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const suffix = `${process.pid}-${Date.now()}`;
const baseImage = `wapilot-controller-base:${suffix}`;
const image = `wapilot-controller-test:${suffix}`;
const proxyImage = `wapilot-controller-proxy:${suffix}`;
const network = `wapilot-controller-test-${suffix}`;
// shortcut: this fixture pins Miniflare's sidecar image, update it when upgrading Wrangler/Miniflare.
const egressImage = 'cloudflare/proxy-everything:3cb1195@sha256:0ef6716c52430096900b150d84a3302057d6cd2319dae7987128c85d0733e3c8';
const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
let runtime, fixtures, receiver, receiverOrigin, workerScript, socket;
const attached = new Set();
const proxies = new Set();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const running = () => docker('ps', '--filter', `ancestor=${image}`, '--format', '{{.ID}}').split('\n').filter(Boolean);

async function send(input, deadline) {
  const pending = runtime.dispatchFetch('https://local/send', { method: 'POST',headers:deadline ? {'x-fixture-deadline':String(deadline)} : {}, body: JSON.stringify(input) })
    .then(async response => ({ status: response.status, data: await response.json() }));
  for (let i = 0; i < 100; i++) {
    const sidecars = docker('ps', '--filter', `ancestor=${proxyImage}`, '--format', '{{.ID}}').split('\n').filter(Boolean);
    for (const proxy of sidecars) if (!attached.has(proxy)) {
        proxies.add(proxy);
        docker('network', 'connect', network, proxy);
        attached.add(proxy);
    }
    if (running().length) break;
    await pause(100);
  }
  return pending;
}

before(async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import { sendCallback } from './src/lib/callback-sender';
      export { CallbackSender } from './src/lib/sender-container';
      export default { async fetch(request, env) {
        try { return Response.json(await sendCallback(env, await request.json(), Number(request.headers.get('x-fixture-deadline')) || undefined)); }
        catch (error) { return Response.json({ code: error.code, reason: error.reason, message: error.message }, { status: error.status ?? 500 }); }
      } };
    ` }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*', 'node:*'],
  });
  docker('build', '--tag', baseImage, 'sender');
  docker('pull', egressImage);
  fixtures = mkdtempSync(join(tmpdir(), 'wapilot-controller-'));
  chmodSync(fixtures, 0o755);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=callback.test',
    '-addext', 'subjectAltName=DNS:callback.test', '-keyout', join(fixtures, 'key.pem'), '-out', join(fixtures, 'cert.pem')], { stdio: 'ignore' });
  chmodSync(join(fixtures, 'key.pem'), 0o644);
  writeFileSync(join(fixtures, 'Dockerfile.proxy'), `FROM ${egressImage}\nCOPY start-proxy.sh /start-proxy.sh\nENTRYPOINT ["/bin/sh", "/start-proxy.sh"]\n`);
  // Stock sidecar discovers ignored NIC ranges once at startup; attach the fixture bridge first.
  writeFileSync(join(fixtures, 'start-proxy.sh'), `for i in $(seq 1 100); do ip -4 -o addr | grep -q 'inet 93.184.216.' && break; sleep 0.1; done\nexec /proxy-everything "$@"\n`);
  docker('build', '--tag', proxyImage, '--file', join(fixtures, 'Dockerfile.proxy'), fixtures);
  writeFileSync(join(fixtures, 'Dockerfile'), `FROM ${baseImage}\nUSER root\nCOPY cert.pem /fixtures/cert.pem\nCOPY boot.mjs /fixtures/boot.mjs\nENV NODE_EXTRA_CA_CERTS=/fixtures/cert.pem\nCMD ["node", "/fixtures/boot.mjs"]\n`);
  writeFileSync(join(fixtures, 'boot.mjs'), `
    import { writeFileSync } from 'node:fs';
    import { networkInterfaces } from 'node:os';
    await new Promise(resolve=>setTimeout(resolve,1000));
    writeFileSync('/etc/resolv.conf', 'nameserver 93.184.216.20\\n');
    for (let i = 0; i < 100 && !Object.values(networkInterfaces()).flat().some(a => a.address.startsWith('93.184.216.')); i++) await new Promise(r => setTimeout(r, 100));
    await import('/app/src/server.mjs');
  `);
  docker('build', '--tag', image, fixtures);
  docker('network', 'create', '--subnet', '93.184.216.0/24', network);
  receiver = docker('run', '--detach', '--rm', '--network', network, '--ip', '93.184.216.20', '--publish', '127.0.0.1::8081',
    '--mount', `type=bind,source=${fixtures},target=/fixtures,readonly`,
    '--mount', `type=bind,source=${join(process.cwd(), 'sender/test')},target=/test,readonly`, baseImage, 'node', '/test/receiver.mjs');
  receiverOrigin = `http://127.0.0.1:${docker('port', receiver, '8081/tcp').split(':').at(-1)}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(receiverOrigin)).ok) break; } catch {} await pause(100); }
  socket = docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}');
  workerScript = bundle.outputFiles[0].text;
  runtime = createRuntime(image);
  await runtime.ready;
}, { timeout: 120_000 });

function createRuntime(senderImage) {
  return new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'],
    script: workerScript, containerEngine: { localDocker: { socketPath: socket, containerEgressInterceptorImage: proxyImage } },
    bindings: { TOKEN_ENCRYPTION_KEY: key },
    durableObjects: { CALLBACK_SENDER: { className: 'CallbackSender', useSQLite: true, container: { images: [{ name: 'sender', image: senderImage }] } } },
  }));
}

after(async () => {
  await runtime?.dispose();
  for (const id of [...running(), ...proxies, receiver].filter(Boolean)) { try { docker('rm', '--force', id); } catch {} }
  try { docker('network', 'rm', network); } catch {}
  for (const tag of [image, baseImage, proxyImage]) { try { docker('image', 'rm', tag); } catch {} }
  if (fixtures) rmSync(fixtures, { recursive: true, force: true });
});

const body = '{ "text": "Olá 👩🏽‍💻\\n" }\n';
const headers = { 'content-type': 'application/json', 'webhook-id': 'evt_controller', 'webhook-timestamp': '1794090000',
  'webhook-signature': 'v1,first v1,second', 'x-mcp-subscription-id': 'sub_controller' };
const input = { url: 'https://callback.test/events', body, headers };

test('does not start a callback after its deadline while a cold Container becomes ready',async()=>{
  const before=(await (await fetch(receiverOrigin)).json()).callbacks.length;
  assert.equal((await send(input,Date.now()+150)).data.reason,'timeout');
  await pause(1500);
  assert.equal((await (await fetch(receiverOrigin)).json()).callbacks.length,before);
}, {timeout:15000});

test('starts one shared sender and preserves approved IP, TLS identity, body and signed headers through Workers', async () => {
  const results = await Promise.all([send(input), send(input)]);
  assert.deepEqual(results, [
    { status: 200, data: { status: 202, body: '{"challenge":"test-challenge"}' } },
    { status: 200, data: { status: 202, body: '{"challenge":"test-challenge"}' } },
  ]);
  assert.equal(running().length, 1);
  const { callbacks, queries } = await (await fetch(receiverOrigin)).json();
  assert.ok(queries['callback.test:1'] >= 1);
  assert.equal(callbacks.length, 2);
  for (const request of callbacks) {
    assert.equal(request.localAddress, '93.184.216.20');
    assert.equal(request.host, 'callback.test');
    assert.equal(request.servername, 'callback.test');
    assert.equal(request.bodyBase64, Buffer.from(body).toString('base64'));
    for (const [name, value] of Object.entries(headers)) assert.equal(request.headers[name], value);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.apikey, undefined);
    assert.equal(request.headers['x-wapilot-deadline'], undefined);
  }
}, { timeout: 45_000 });

test('preserves DNS/TLS rejection and redirects as non-acceptance through the controller', async () => {
  const before = (await (await fetch(receiverOrigin)).json()).callbacks.length;
  assert.deepEqual(await send({ ...input, url: 'https://private.test/events' }), {
    status: 400, data: { code: 'sender_destination_blocked', reason: 'destination_blocked', message: 'WaPilot could not reach the callback sender.' },
  });
  assert.equal((await send({ ...input, url: 'https://wrong-host.test/events' })).status, 503);
  assert.equal((await (await fetch(receiverOrigin)).json()).callbacks.length, before);
  assert.deepEqual(await send({ ...input, url: 'https://callback.test/redirect' }), { status: 200, data: { status: 302, body: 'redirect' } });
}, { timeout: 45_000 });

test('stops the shared container after a minute idle and restarts it for the next callback', async () => {
  const id = running()[0];
  const started = Date.now();
  for (let i = 0; i < 150 && running().includes(id); i++) await pause(500);
  assert.equal(running().includes(id), false);
  assert.ok(Date.now() - started >= 55_000, 'the sender should remain available for a minute');
  assert.deepEqual(await send(input), { status: 200, data: { status: 202, body: '{"challenge":"test-challenge"}' } });
  assert.equal(running().length, 1);
}, { timeout: 110_000 });

test('drains an active callback on SIGTERM and starts the sender again on demand', async () => {
  const id = running()[0];
  const pending = send({ ...input, url: 'https://callback.test/finish-after-sigterm' });
  for (let i = 0; i < 50; i++) {
    const { callbacks } = await (await fetch(receiverOrigin)).json();
    if (callbacks.at(-1)?.path === '/finish-after-sigterm') break;
    await pause(50);
  }
  docker('kill', '--signal', 'SIGTERM', id);
  assert.deepEqual(await pending, { status: 200, data: { status: 202, body: 'accepted' } });
  for (let i = 0; i < 150 && running().includes(id); i++) await pause(100);
  assert.equal(running().includes(id), false);
  assert.deepEqual(await send(input), { status: 200, data: { status: 202, body: '{"challenge":"test-challenge"}' } });
  assert.equal(running().length, 1);
  assert.notEqual(running()[0], id);
}, { timeout: 45_000 });

test('does not report callback acceptance when the sender image cannot start', async () => {
  await runtime.dispose();
  for (const id of [...running(), ...proxies]) { try { docker('rm', '--force', id); } catch {} }
  runtime = createRuntime(`wapilot-missing-image:${suffix}`);
  await runtime.ready;
  const before = (await (await fetch(receiverOrigin)).json()).callbacks.length;
  const result = await send(input);
  assert.ok(result.status >= 500);
  assert.equal(result.data.message, 'WaPilot could not reach the callback sender.');
  assert.equal(result.data.status, undefined);
  assert.equal((await (await fetch(receiverOrigin)).json()).callbacks.length, before);
}, { timeout: 45_000 });
