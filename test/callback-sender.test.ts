import { afterEach, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

let runtime: Miniflare;
afterEach(async () => { await runtime?.dispose(); });

async function worker(className?: string, reply: unknown = {}, status = 200, aborted = false) {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import { sendCallback } from './src/lib/callback-sender';
      import { DurableObject } from 'cloudflare:workers';
      export { CallbackSender } from './src/lib/sender-container';
      export class Reply extends DurableObject { fetch() { return Response.json(JSON.parse(this.env.REPLY), { status: this.env.STATUS }); } }
      export default { async fetch(request, env) {
        try { return Response.json(await sendCallback(env, await request.json(), env.ABORTED ? Date.now()-1 : undefined)); }
        catch (error) { return Response.json({ code: error.code, reason: error.reason, message: error.message }, { status: error.status }); }
      } };
    ` },
    bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*', 'node:*'],
  });
  runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: '2026-10-13', script: bundle.outputFiles[0].text,
    bindings: { REPLY: JSON.stringify(reply) ?? 'null', STATUS: status, ABORTED:aborted },
    ...(className ? { durableObjects: { CALLBACK_SENDER: { className, useSQLite: true } } } : {}),
  }));
  return runtime.dispatchFetch('https://local/send', {
    method: 'POST', body: JSON.stringify({ url: 'https://callback.test/private-path', body: 'private-text', headers: {} }),
  });
}

it.each([undefined, 'CallbackSender'])('returns a safe failure when sender configuration %s is unavailable', async className => {
  const response = await worker(className);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: 'sender_unavailable', reason: 'unavailable', message: 'WaPilot could not reach the callback sender.' });
});

it('preserves the actual callback status and truncation flag without mistaking sender HTTP 200 for acceptance', async () => {
  const response = await worker('Reply', { status: 410, body: 'gone', bodyTruncated: true, ignored: 'not part of the contract' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 410, body: 'gone', bodyTruncated: true });
});

it.each([
  [504, 'callback_timeout', 504, 'timeout'], [400, 'destination_blocked', 400, 'destination_blocked'],
  [400, 'invalid_request', 400, 'invalid_request'], [401, 'private-token', 503, 'unavailable'],
])('categorizes sender HTTP %s without exposing its error payload', async (upstreamStatus, error, expectedStatus, reason) => {
  const response = await worker('Reply', { error, url: 'https://private.test', authorization: 'secret' }, Number(upstreamStatus));
  expect(response.status).toBe(expectedStatus);
  expect(await response.json()).toEqual({ code: `sender_${reason}`, reason, message: 'WaPilot could not reach the callback sender.' });
});

it.each([
  { status: 202 }, { status: '202', body: '' }, { status: 600, body: '' },
  { status: 202, body: '', bodyTruncated: 'yes' }, { status: 202, body: 'x'.repeat(16 * 1024 + 1) },
  { status: 202, body: '', overflow: 'x'.repeat(128 * 1024) },
])('rejects a malformed or oversized sender reply', async reply => {
  const response = await worker('Reply', reply);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: 'sender_unavailable', reason: 'unavailable', message: 'WaPilot could not reach the callback sender.' });
});

it('rejects an already expired caller deadline before starting the sender',async()=>{
  const response=await worker('Reply',{status:202,body:''},200,true);
  expect(response.status).toBe(504);
  expect(await response.json()).toEqual({code:'sender_timeout',reason:'timeout',message:'WaPilot could not reach the callback sender.'});
});
