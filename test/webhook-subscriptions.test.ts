import { afterAll, beforeAll, expect, it } from 'vitest';
import { eventRuntime } from './helpers/mcp-events-runtime';

const host = 'routines.example.test';
const tool = 'manage_webhook_subscription';
let fixture: Awaited<ReturnType<typeof eventRuntime>>;
let owner: Awaited<ReturnType<typeof fixture.issue>>;
const destinationId = '3c57aa75-e952-4d99-a708-7778b8fe0f79';

beforeAll(async () => {
  fixture = await eventRuntime(async () => { throw new Error('Subscription activation must not call the receiver'); }, '9999', {WEBHOOK_ROUTINE_HOST:host});
  owner = await fixture.issue();
});
afterAll(async () => { await fixture?.runtime.dispose(); });

function call(token: string, args: Record<string, unknown>) {
  return fixture.rpc(token, 'tools/call', { name:tool, arguments:args }, {'Mcp-Name':tool});
}

it('exposes one tool after destination setup and only for its OAuth grant', async () => {
  const discover = () => fixture.rpc(owner.accessToken, 'tools/list');
  expect((await discover()).body.result.tools.map((entry: {name:string}) => entry.name)).not.toContain(tool);

  await fixture.db.prepare("INSERT INTO webhook_destinations (id,user_id,connection_id,grant_id,label,url,hostname,conversation_ids,encrypted_key) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(destinationId,owner.userId,owner.connections[0],owner.grantId,'Routine','https://'+host+'/automations/webhook/example',host,'["5511999999999"]','synthetic-ciphertext').run();
  expect((await discover()).body.result.tools.filter((entry: {name:string}) => entry.name === tool)).toHaveLength(1);
  const subscribe = {operation:'subscribe',destinationId,filter:{connectionId:owner.connections[0],conversationId:'5511999999999'}};
  const first = (await call(owner.accessToken,subscribe)).body.result.structuredContent.data;
  expect(first).toMatchObject({subscriptionId:expect.stringMatching(/^sub_/),filter:subscribe.filter,refreshBefore:expect.any(String)});

  const alias = (await call(owner.accessToken,{...subscribe,filter:{...subscribe.filter,conversationId:'5511999999999:12@s.whatsapp.net'}})).body;
  expect(alias.result.structuredContent.data.subscriptionId).toBe(first.subscriptionId);
  const rejected = (await call(owner.accessToken,{...subscribe,filter:{...subscribe.filter,conversationId:'5511888888888'}})).body;
  expect(rejected.result.isError).toBe(true);
  const mixed = (await call(owner.accessToken,{...subscribe,operation:'unsubscribe',subscriptionId:first.subscriptionId})).body;
  expect(mixed.error ?? mixed.result?.isError).toBeTruthy();

  const other = await fixture.issue({clientId:owner.clientId});
  const foreign = (await call(other.accessToken,subscribe)).body;
  expect(foreign.error ?? foreign.result?.isError).toBeTruthy();

  const cancel = {operation:'unsubscribe',subscriptionId:first.subscriptionId};
  for (let i=0; i<2; i++) {
    expect((await call(owner.accessToken,cancel)).body.result.structuredContent.data.state).toBe('cancelled');
  }
});

it('hides the enrolled fallback from known MCP Events clients', async () => {
  await fixture.fetch('/fixture/native-clients', {method:'POST', body:JSON.stringify([owner.clientId])});
  const catalog = (await fixture.rpc(owner.accessToken, 'tools/list')).body;
  expect(catalog.result.tools.map((entry: {name:string}) => entry.name)).not.toContain(tool);
  const direct = (await call(owner.accessToken, {operation:'unsubscribe',subscriptionId:'sub_'+'0'.repeat(64)})).body;
  expect(direct.error ?? direct.result?.isError).toBeTruthy();
  expect((await fixture.rpc(owner.accessToken, 'events/list')).body.result.events[0].name).toBe('message.received');
});
