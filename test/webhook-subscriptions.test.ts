import { afterAll, beforeAll, expect, it } from 'vitest';
import { eventRuntime } from './helpers/mcp-events-runtime';

const host = 'routines.example.test';
const tool = 'manage_webhook_subscription';
let fixture: Awaited<ReturnType<typeof eventRuntime>>;
let owner: Awaited<ReturnType<typeof fixture.issue>>;
const url = 'https://'+host+'/automations/webhook/example';
const senderKey = 'synthetic-routine-sender-key';

beforeAll(async () => {
  fixture = await eventRuntime(async () => { throw new Error('Subscription activation must not call the receiver'); }, '9999', {WEBHOOK_ROUTINE_HOST:host});
  owner = await fixture.issue();
});
afterAll(async () => { await fixture?.runtime.dispose(); });

function call(token: string, args: Record<string, unknown>) {
  return fixture.rpc(token, 'tools/call', { name:tool, arguments:args }, {'Mcp-Name':tool});
}

it('accepts routine credentials directly and scopes each subscription to its OAuth grant', async () => {
  const discover = () => fixture.rpc(owner.accessToken, 'tools/list');
  expect((await discover()).body.result.tools.filter((entry: {name:string}) => entry.name === tool)).toHaveLength(1);
  const subscribe = {operation:'subscribe',url,senderKey,filter:{connectionId:owner.connections[0],conversationId:'5511999999999'}};
  const first = (await call(owner.accessToken,subscribe)).body.result.structuredContent.data;
  expect(first).toMatchObject({subscriptionId:expect.stringMatching(/^sub_/),filter:subscribe.filter,refreshBefore:expect.any(String)});

  const alias = (await call(owner.accessToken,{...subscribe,filter:{...subscribe.filter,conversationId:'5511999999999:12@s.whatsapp.net'}})).body;
  expect(alias.result.structuredContent.data.subscriptionId).toBe(first.subscriptionId);
  const rejected = (await call(owner.accessToken,{...subscribe,filter:{...subscribe.filter,conversationId:'*'}})).body;
  expect(rejected.result.isError).toBe(true);
  const mixed = (await call(owner.accessToken,{...subscribe,operation:'unsubscribe',subscriptionId:first.subscriptionId})).body;
  expect(mixed.error ?? mixed.result?.isError).toBeTruthy();

  const other = await fixture.issue({clientId:owner.clientId});
  const otherWatch = (await call(other.accessToken,subscribe)).body.result.structuredContent.data;
  expect(otherWatch.subscriptionId).not.toBe(first.subscriptionId);
  await call(other.accessToken,{operation:'unsubscribe',subscriptionId:first.subscriptionId});
  expect(await fixture.db.prepare('SELECT state FROM event_subscriptions WHERE id = ?').bind(first.subscriptionId).first('state')).toBe('active');
  const persisted = await fixture.db.prepare('SELECT encrypted_key FROM webhook_destinations WHERE grant_id = ?').bind(owner.grantId).first('encrypted_key');
  expect(persisted).toEqual(expect.any(String));
  expect(persisted).not.toBe(senderKey);
  expect(JSON.stringify(first)).not.toContain(senderKey);
  const blocked = (await call(owner.accessToken,{...subscribe,url:'https://elsewhere.example/automations/webhook/example'})).body;
  expect(blocked.result.isError).toBe(true);

  const cancel = {operation:'unsubscribe',subscriptionId:first.subscriptionId};
  for (let i=0; i<2; i++) {
    expect((await call(owner.accessToken,cancel)).body.result.structuredContent.data.state).toBe('cancelled');
  }
  expect(await fixture.db.prepare('SELECT encrypted_key FROM webhook_destinations WHERE grant_id = ?').bind(owner.grantId).first('encrypted_key')).toBeNull();
});

it('hides the fallback from known MCP Events clients', async () => {
  await fixture.fetch('/fixture/native-clients', {method:'POST', body:JSON.stringify([owner.clientId])});
  const catalog = (await fixture.rpc(owner.accessToken, 'tools/list')).body;
  expect(catalog.result.tools.map((entry: {name:string}) => entry.name)).not.toContain(tool);
  const direct = (await call(owner.accessToken, {operation:'unsubscribe',subscriptionId:'sub_'+'0'.repeat(64)})).body;
  expect(direct.error ?? direct.result?.isError).toBeTruthy();
  expect((await fixture.rpc(owner.accessToken, 'events/list')).body.result.events[0].name).toBe('message.received');
});

it('clears the stored key when a watch expires and accepts renewal with a supplied key', async () => {
  const account = await fixture.issue();
  const args = {operation:'subscribe',url,senderKey,filter:{connectionId:account.connections[0],conversationId:'5511999999999'},ttlMs:60_000};
  const first = (await call(account.accessToken,args)).body.result.structuredContent.data;
  const key = () => fixture.db.prepare(`SELECT d.encrypted_key FROM webhook_destinations d
    JOIN event_subscriptions s ON s.destination_id = d.id WHERE s.id = ?`).bind(first.subscriptionId).first('encrypted_key');
  const pastExpiry = Date.parse(first.refreshBefore) + 1;
  try {
    await fixture.clock(pastExpiry);
    await fixture.scheduled(pastExpiry);
    expect(await key()).toBeNull();
    const renewed = (await call(account.accessToken,args)).body.result.structuredContent.data;
    expect(renewed.subscriptionId).toBe(first.subscriptionId);
    expect(await key()).toEqual(expect.any(String));
  } finally { await fixture.clock(); }
});
