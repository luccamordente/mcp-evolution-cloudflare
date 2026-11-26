import { afterAll, beforeAll, expect, it } from 'vitest';
import { eventRuntime } from './helpers/mcp-events-runtime';

const host = 'routine.example.test';
const key = 'synthetic-routine-key';
const tool = 'manage_webhook_subscription';
const conversationId = '5511999999999';
const otherConversation = '5511888888888';
let fixture: Awaited<ReturnType<typeof eventRuntime>>;
let receiver: (request: Request) => Promise<Response>;
const requests: Record<string, unknown>[] = [];
let sequence = 0;

beforeAll(async () => {
  fixture = await eventRuntime(async request => {
    const input = await request.json() as Record<string, unknown>;
    requests.push(input);
    return receiver(request);
  }, '9999', { WEBHOOK_ROUTINE_HOST: host });
});
afterAll(async () => { await fixture?.runtime.dispose(); });

async function watch() {
  const email = `routine-${++sequence}@example.test`;
  const owner = await fixture.issue({ email });
  const connectionId = owner.connections[0];
  const hook = await fixture.webhook(connectionId);
  const url = `https://${host}/automations/webhook/${crypto.randomUUID()}`;
  const call = async (args: Record<string, unknown>) => (await fixture.rpc(owner.accessToken, 'tools/call',
    { name: tool, arguments: args }, { 'Mcp-Name': tool })).body;
  const filter = { connectionId, conversationId };
  const subscription = await call({ operation: 'subscribe', url, senderKey: key, filter });
  expect(subscription).toMatchObject({ result: { structuredContent: { data: { subscriptionId: expect.stringMatching(/^sub_/) } } } });
  const subscriptionId: string = subscription.result.structuredContent.data.subscriptionId;
  async function emit(id: string, chat: string, senderAlt?: string) {
    const payload = { jsonapi: { version: '1.1' }, meta: { event: 'Message', instanceId: hook.instanceId }, data: {
      type: 'message', id, attributes: { at: Date.now() + 10, encodingFormat: 'text/plain', body: { text: `Preview ${id}` } },
      relationships: { author: { data: { type: 'chat', id: conversationId } } }, meta: { chat, fromMe: false, senderAlt },
    } };
    const response = await fixture.fetch(hook.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect(response.status).toBe(202);
    return fixture.published.splice(0);
  }
  return { owner, url, filter, subscriptionId, call, emit };
}

function delivery(id: unknown) {
  return fixture.db.prepare('SELECT state, body, result_code, next_attempt_at FROM event_deliveries WHERE id = ?')
    .bind(id).first<{ state: string; body: string | null; result_code: string | null; next_attempt_at: number }>();
}

it('delivers only the selected chat, matches a verified direct-chat alias, and honors unsubscribe', async () => {
  receiver = async () => Response.json({ status: 200, body: '' });
  const initialRequests = requests.length;
  const { url, emit, call, subscriptionId } = await watch();
  expect(requests).toHaveLength(initialRequests);
  expect(await emit('adjacent', otherConversation)).toEqual([]);
  expect(await emit('group-participant', '1234@g.us', `${conversationId}@s.whatsapp.net`)).toEqual([]);
  const jobs = await emit('match', '48231@lid', `${conversationId}:2@s.whatsapp.net`);
  expect(jobs).toEqual([expect.any(String)]);
  expect(await emit('match', `${conversationId}@s.whatsapp.net`)).toEqual([]);
  await fixture.queue(jobs);
  expect(requests.slice(initialRequests)).toEqual([{ kind: 'bearer', url, key, body: expect.any(String) }]);
  expect(JSON.parse(String(requests[initialRequests].body))).toMatchObject({
    name: 'message.received', data: { messageId: 'match', preview: 'Preview match' },
  });
  expect(await delivery(jobs[0])).toMatchObject({ state: 'accepted', body: null });
  const stopped = await emit('pending-before-stop', conversationId);
  expect(stopped).toHaveLength(1);
  expect((await call({ operation: 'unsubscribe', subscriptionId })).result?.isError).not.toBe(true);
  await fixture.queue(stopped);
  expect(await delivery(stopped[0])).toMatchObject({ state: 'cancelled', body: null });
  expect(await emit('after-stop', conversationId)).toEqual([]);
  expect(requests).toHaveLength(initialRequests + 1);
});

it('retries a receiver rate limit with the same event and ends an ambiguous subsequent result', async () => {
  try {
    const { emit } = await watch();
    const jobs = await emit('retry', conversationId);
    expect(jobs).toHaveLength(1);
    const initialRequests = requests.length;
    receiver = async () => Response.json({ status: 429, body: '' });
    expect((await fixture.queue(jobs)).retryMessages).toHaveLength(1);
    const pending = await delivery(jobs[0]);
    expect(pending).toMatchObject({ state: 'pending', body: expect.any(String) });
    await fixture.clock(pending?.next_attempt_at);
    receiver = async () => Response.json({ error: 'callback_timeout' }, { status: 504 });
    expect((await fixture.queue(jobs)).retryMessages).toHaveLength(0);
    expect(await delivery(jobs[0])).toMatchObject({ state: 'failed', body: null, result_code: 'delivery_unknown' });
    expect(requests.slice(initialRequests).map(request => request.body)).toEqual([pending?.body, pending?.body]);
    await fixture.scheduled(Date.now() + 120000);
    await fixture.queue(jobs);
    expect(requests).toHaveLength(initialRequests + 2);
  } finally { await fixture.clock(); }
});

it('uses the current destination key for queued work and drops pending content after grant revocation', async () => {
  const { owner, url, filter, call, emit } = await watch();
  const jobs = await emit('before-rotation', conversationId);
  expect(jobs).toHaveLength(1);
  const initialRequests = requests.length;
  const newKey = 'rotated-routine-key';
  const renewal = await call({ operation: 'subscribe', url, senderKey: newKey, filter });
  expect(renewal.result.isError).toBeFalsy();
  receiver = async () => Response.json({ status: 200, body: '' });
  await fixture.queue(jobs);
  expect(requests.slice(initialRequests)).toEqual([expect.objectContaining({ key: newKey })]);
  const revoked = await emit('before-revocation', conversationId);
  expect(revoked).toHaveLength(1);
  const response = await fixture.fetch('/fixture/revoke?' + new URLSearchParams({
    grantId: owner.grantId, providerUserId: encodeURIComponent(`routine-${sequence}@example.test`),
  }));
  expect(response.status).toBe(200);
  expect(await emit('after-revocation', conversationId)).toEqual([]);
  await fixture.queue(revoked);
  expect(await delivery(revoked[0])).toMatchObject({ state: 'cancelled', body: null });
  expect(requests).toHaveLength(initialRequests + 1);
});

it('records an abandoned bearer dispatch as unknown and never sends it again', async () => {
  const { emit } = await watch();
  const jobs = await emit('abandoned', conversationId);
  const initialRequests = requests.length;
  let entered!: () => void;
  let release!: () => void;
  const sending = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  receiver = async () => {
    entered();
    await held;
    return Response.json({ status: 200, body: '' });
  };
  const first = fixture.queue(jobs);
  try {
    await sending;
    const lease = await fixture.db.prepare('SELECT lease_until FROM event_deliveries WHERE id = ?').bind(jobs[0]).first<number>('lease_until');
    expect(lease).toEqual(expect.any(Number));
    await fixture.clock(Number(lease) + 1);
    await fixture.scheduled(Number(lease) + 1);
    await fixture.queue(jobs);
    expect(await delivery(jobs[0])).toMatchObject({ state: 'failed', body: null, result_code: 'delivery_unknown' });
    expect(requests).toHaveLength(initialRequests + 1);
  } finally {
    release();
    await first;
    await fixture.clock();
  }
});
