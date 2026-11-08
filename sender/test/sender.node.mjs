import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { after, before, test } from 'node:test';

const token = 'test-only-sender-token-with-32-characters';
let child;
let origin;

before(async () => {
  child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, CALLBACK_SENDER_TOKEN: token, PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sender did not start')), 3000);
    child.once('exit', () => { clearTimeout(timer); reject(new Error('sender exited before readiness')); });
    child.stdout.on('data', (chunk) => {
      const match = chunk.toString().match(/WaPilot sender ready: (\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    });
  });
});

after(async () => {
  if (child?.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
});

test('rejects unauthenticated calls before parsing or contacting a callback', async () => {
  const response = await fetch(`${origin}/send`, { method: 'POST', body: '{invalid' });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
});

const headers = {
  'content-type': 'application/json',
  'webhook-id': 'evt_test',
  'webhook-timestamp': '1794090000',
  'webhook-signature': 'v1,test-signature',
  'x-mcp-subscription-id': 'sub_test',
};

async function send(input) {
  return fetch(`${origin}/send`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-wapilot-deadline':String(Date.now()+45000) },
    body: JSON.stringify({ url: 'https://callback.test/events', body: '{}', headers, ...input }),
  });
}

test('rejects non-HTTPS, URL credentials, forbidden headers and oversized bodies', async () => {
  for (const input of [
    { url: 'http://callback.test/events' },
    { url: 'https://user:secret@callback.test/events' },
    { url: `https://callback.test/${'a'.repeat(2048)}` },
    { headers: { ...headers, authorization: 'Bearer oauth-token' } },
    { headers: { ...headers, apikey: 'instance-token' } },
    { headers: { ...headers, 'webhook-signature': 'v1,signature\r\nInjected: header' } },
    { method: 'GET' },
    { body: 'é'.repeat(128 * 1024 + 1) },
  ]) {
    const response = await send(input);
    assert.equal(response.status, 400, JSON.stringify(Object.keys(input)));
    assert.deepEqual(await response.json(), { error: 'invalid_request' });
  }
});

test('blocks nonpublic IP destinations, including URL-normalized and mapped forms', async () => {
  for (const host of [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.31.0.1', '192.0.0.1', '192.0.2.1', '192.88.99.1', '192.168.1.1',
    '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
    '2130706433', '0x7f000001', '0177.0.0.1', '[::]', '[::1]', '[::ffff:127.0.0.1]',
    '[64:ff9b::7f00:1]', '[100::1]', '[2001::1]', '[2001:db8::1]', '[2002:7f00:1::]',
    '[3fff::1]', '[fc00::1]', '[fe80::1]', '[ff02::1]',
  ]) {
    const response = await send({ url: `https://${host}/events` });
    assert.equal(response.status, 400, host);
    assert.deepEqual(await response.json(), { error: 'destination_blocked' });
  }
});

test('accepts only JSON requests and bounds the complete internal envelope', async () => {
  const notJson = await fetch(`${origin}/send`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
    body: JSON.stringify({ url: 'https://callback.test/events', body: '{}', headers }),
  });
  assert.equal(notJson.status, 400);
  assert.deepEqual(await notJson.json(), { error: 'invalid_request' });
  const oversized = await fetch(`${origin}/send`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-wapilot-deadline':String(Date.now()+45000) },
    body: ' '.repeat(2 * 1024 * 1024 + 1),
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: 'request_too_large' });
});

test('requires a valid authenticated absolute deadline and rejects expired work before contacting a callback', async () => {
  for (const value of [undefined,'', 'NaN', 'Infinity','-1','1.5','9007199254740992',String(Date.now()-1)]) {
    const response=await fetch(`${origin}/send`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(value === undefined ? {} : {'x-wapilot-deadline':value})},body:JSON.stringify({url:'https://callback.test/events',body:'{}',headers})});
    const expired=value !== undefined && /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
    assert.equal(response.status,expired ? 504 : 400,value);
    assert.deepEqual(await response.json(),{error:expired ? 'callback_timeout' : 'invalid_request'});
  }
});
