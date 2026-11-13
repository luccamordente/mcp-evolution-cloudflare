import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMcpHandler, PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { createMcpServer } from '../src/lib/mcp';
import { bootstrapLocalUser, createConnection, ensureUser } from '../src/lib/db';
import type { AuthenticatedUser, Env } from '../src/types';
import { createTestD1 } from './helpers/local-d1';

const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const user: AuthenticatedUser = { id: 'claim-a', email: 'a@example.test', claims: {} };
const jsonapi = { version: '1.1' };
let local: Awaited<ReturnType<typeof createTestD1>>;
let env: Env;
let connectionId: string;
let sent: number;

async function call(name: string, args: Record<string, unknown>, principal = user, scopes = ['mcp:read', 'mcp:write']) {
  const handler = createMcpHandler(() => createMcpServer(env, principal), { legacy: 'reject', responseMode: 'json' });
  const response = await handler.fetch(new Request('https://mcp.invalid/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': name },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, _meta: {
      [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
      [CLIENT_INFO_META_KEY]: { name: 'send-idempotency-tests', version: '1' },
      [CLIENT_CAPABILITIES_META_KEY]: {},
    } } }),
  }), { authInfo: { token: 'test', clientId: 'test-client', scopes } });
  return (await response.json() as { result: { isError?: boolean; structuredContent: { data: any } } }).result;
}

beforeEach(async () => {
  local = await createTestD1();
  const ensured = await bootstrapLocalUser(local.db, user);
  const connection = await createConnection(local.db, encryptionKey, { userId: ensured.id, friendlyName: 'Test', instanceId: 'instance-a', token: 'instance-secret' });
  connectionId = connection.id;
  env = { DB: local.db, TOKEN_ENCRYPTION_KEY: encryptionKey, EVOLUTION_BASE_URL: 'https://provider.invalid', ENVIRONMENT: 'local' };
  sent = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === '/message/search') return Response.json({ jsonapi, data: [] });
    if (path === '/message/status') return Response.json({ jsonapi, data: { type: 'message', id: 'SOURCE', attributes: { encodingFormat: 'text/plain', body: { text: 'Retained source' } }, meta: { chat: '5511888888888' } } });
    return Response.json({ jsonapi, data: { type: 'message', id: `SENT-${++sent}`, meta: { chat: '5511999999999' } } });
  });
});

afterEach(async () => { vi.restoreAllMocks(); await local?.dispose(); });

describe('send idempotency through MCP with real D1', () => {
  it('reuses a completed send instead of sending twice', async () => {
    const args = { to: '5511999999999', text: 'Uma ação única', idempotencyKey: 'action-1' };
    const first = await call('send_text', args);
    const repeated = await call('send_text', { ...args, connectionId });
    expect(first.isError).toBeFalsy();
    expect(repeated.structuredContent).toEqual(first.structuredContent);
    expect(first).toMatchObject({ _meta: { sendReceipt: { state: 'accepted', text: args.text } } });
    expect(repeated).toMatchObject({ _meta: { sendReceipt: { state: 'accepted', text: args.text } } });
    expect(first.structuredContent.data.messageId).toBe('SENT-1');
    const status = await call('get_send_status', {operation:'send_text', idempotencyKey:'action-1'});
    expect(status.structuredContent.data).toMatchObject({outcome:'accepted',messageId:'SENT-1',deliveryStatus:'unavailable',readStatus:'unavailable'});
    expect(sent).toBe(1);
  });

  it.each([
    ['send_text', { to: '5511999999999', text: 'Primeiro texto' }, { text: 'Outro texto' }],
    ['reply_to_message', { to: '5511999999999', text: 'Resposta', messageId: 'SOURCE' }, { participant: '5511777777777' }],
    ['forward_message', { to: '5511999999999', conversationId: '5511888888888', messageId: 'SOURCE' }, { conversationId: '5511777777777' }],
    ['send_media', { to: '5511999999999', mimeType: 'image/png', dataBase64: btoa('test-image') }, { dataBase64: btoa('other-image') }],
    ['send_media', { to: '5511999999999', mimeType: 'video/mp4', dataBase64: btoa('test-video') }, { gifPlayback: true }],
  ])('rejects conflicting arguments for the same action key on %s', async (name, args, changed) => {
    await call(name, { ...args, idempotencyKey: 'action-1' });
    const conflict = await call(name, { ...args, ...changed, idempotencyKey: 'action-1' });
    expect(conflict.isError).toBe(true);
    expect(conflict.structuredContent.data.error).toMatchObject({ code: 'idempotency_conflict', status: 409, retryable: false });
    if (name === 'send_text' || name === 'reply_to_message') expect(conflict).toMatchObject({ _meta: { sendReceipt: { state: 'failed' } } });
    expect(sent).toBe(1);
  });

  it.each(['', '   ', 'a'.repeat(201), 42, null])('rejects an invalid action key (%j) before sending', async idempotencyKey => {
    const result = await call('send_text', { to: '5511999999999', text: 'Não enviar', idempotencyKey });
    expect(result.isError).toBe(true);
    expect(sent).toBe(0);
    expect((await local.db.prepare('SELECT COUNT(*) AS count FROM send_operations').first<{ count: number }>())?.count).toBe(0);
  });

  it.each([
    ['reply_to_message', { to: '5511999999999', text: 'Resposta', messageId: 'SOURCE' }],
    ['forward_message', { to: '5511999999999', conversationId: '5511888888888', messageId: 'SOURCE' }],
    ['send_media', { to: '5511999999999', mimeType: 'image/png', dataBase64: btoa('test-image'), caption: 'Legenda' }],
  ])('reuses the completed result for %s', async (name, args) => {
    const keyed = { ...args, idempotencyKey: 'action-1' };
    const first = await call(name, keyed);
    const repeated = await call(name, keyed);
    expect(first.isError).toBeFalsy();
    expect(repeated.structuredContent).toEqual(first.structuredContent);
    if (name === 'reply_to_message') expect(repeated).toMatchObject({ _meta: { sendReceipt: { state: 'accepted', isReply: true } } });
    expect(first.structuredContent.data.messageId).toBe('SENT-1');
    expect(sent).toBe(1);
  });

  it('does not send twice when the same action arrives concurrently', async () => {
    let release!: () => void;
    let started!: () => void;
    const reachedProvider = new Promise<void>(resolve => { started = resolve; });
    const finishSend = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(fetch).mockImplementation(async () => {
      sent++;
      started();
      await finishSend;
      return Response.json({ jsonapi, data: { type: 'message', id: 'CONCURRENT' } });
    });
    const args = { to: '5511999999999', text: 'Só uma vez', idempotencyKey: 'concurrent' };
    const pending = call('send_text', args);
    await reachedProvider;
    try {
      const duplicate = await call('send_text', args);
      expect(duplicate.structuredContent.data).toMatchObject({outcome:'pending',error:{ code: 'send_in_progress', retryable: false }});
      expect((await call('get_send_status',{operation:'send_text',idempotencyKey:'concurrent'})).structuredContent.data.outcome).toBe('pending');
      expect(duplicate).toMatchObject({ _meta: { sendReceipt: { state: 'unknown' } } });
      expect(sent).toBe(1);
    } finally { release(); }
    expect((await pending).structuredContent.data.messageId).toBe('CONCURRENT');
    expect((await call('send_text', args)).structuredContent.data.messageId).toBe('CONCURRENT');
    expect(sent).toBe(1);
  });

  it.each(['timeout', 'network'])('keeps an unknown result reserved after a %s failure', async failure => {
    vi.mocked(fetch).mockImplementation(async () => {
      sent++;
      if (failure === 'network') throw new Error('Network disconnected');
      return Response.json({ jsonapi, errors: [{ status: '504', detail: 'Timed out' }] }, { status: 504 });
    });
    const args = { to: '5511999999999', text: 'Resultado incerto', idempotencyKey: 'unknown' };
    expect((await call('send_text', args)).isError).toBe(true);
    const repeated = await call('send_text', args);
    expect(repeated.structuredContent.data.error).toMatchObject({ code: 'send_result_unknown', status: 409, retryable: false });
    expect(repeated).toMatchObject({ _meta: { sendReceipt: { state: 'unknown' } } });
    expect(sent).toBe(1);
    const status = await call('get_send_status', { operation: 'send_text', idempotencyKey: 'unknown' });
    expect(status.structuredContent.data).toMatchObject({ outcome: 'unknown' });
  });

  it('fails closed without revealing database details when reservation storage is unavailable', async () => {
    await local.db.prepare('DROP TABLE send_operations').run();
    const result = await call('send_text', { to: '5511999999999', text: 'Não enviar', idempotencyKey: 'storage' });
    expect(result.structuredContent.data.error).toMatchObject({ code: 'send_idempotency_unavailable', status: 503, retryable: false });
    expect(JSON.stringify(result.structuredContent)).not.toMatch(/D1_|SQL|send_operations|Não enviar/);
    expect(result).toMatchObject({ _meta: { sendReceipt: { state: 'failed' } } });
    expect(sent).toBe(0);
  });

  it('does not send again if saving an accepted result fails', async () => {
    await local.db.prepare(`CREATE TRIGGER fail_save_result BEFORE UPDATE OF state ON send_operations
      WHEN NEW.state = 'completed' BEGIN SELECT RAISE(ABORT, 'private-database-detail'); END`).run();
    const args = { to: '5511999999999', text: 'Enviado antes da falha', idempotencyKey: 'save-failed' };
    const first = await call('send_text', args);
    const repeated = await call('send_text', args);
    expect(first.structuredContent.data.messageId).toBe('SENT-1');
    expect(first.structuredContent.data.accepted).toBe(true);
    expect(repeated.structuredContent.data.error.code).toBe('send_result_unknown');
    expect(JSON.stringify(first)).not.toContain('private-database-detail');
    expect(sent).toBe(1);
  });

  it('isolates keys by user, resolved connection and operation, after checking permissions', async () => {
    const ensured = await ensureUser(local.db, user);
    const second = await createConnection(local.db, encryptionKey, { userId: ensured.id, friendlyName: 'Second', instanceId: 'instance-b', token: 'second-secret' });
    const other: AuthenticatedUser = { id: 'claim-b', email: 'b@example.test', claims: {} };
    const otherUser = await bootstrapLocalUser(local.db, other);
    const otherConnection = await createConnection(local.db, encryptionKey, { userId: otherUser.id, friendlyName: 'Other', instanceId: 'instance-c', token: 'other-secret' });
    const args = { to: '5511999999999', text: 'Ação por conta', idempotencyKey: 'same-key' };
    const denied = await call('send_text', args, user, ['mcp:read']);
    expect(denied.structuredContent.data.error.code).toBe('insufficient_scope');
    expect((await call('send_text', args)).structuredContent.data.messageId).toBe('SENT-1');
    const foreign = await call('send_text', { ...args, connectionId: otherConnection.id });
    expect(foreign.structuredContent.data.error.code).toBe('connection_not_found');
    expect((await call('send_text', { ...args, connectionId: second.id })).structuredContent.data.messageId).toBe('SENT-2');
    expect((await call('reply_to_message', { ...args, messageId: 'SOURCE' })).structuredContent.data.messageId).toBe('SENT-3');
    expect((await call('send_text', args, other)).structuredContent.data.messageId).toBe('SENT-4');
    expect((await call('send_text', args)).structuredContent.data.messageId).toBe('SENT-1');
    expect(sent).toBe(4);
  });

  it('expires the protection exactly 24 hours after reservation, even without scheduled cleanup', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const args = { to: '5511999999999', text: 'Janela de proteção', idempotencyKey: 'expires' };
    await call('send_text', args);
    clock.mockReturnValue(1_800_086_399_999);
    expect((await call('send_text', args)).structuredContent.data.messageId).toBe('SENT-1');
    clock.mockReturnValue(1_800_086_400_000);
    expect((await call('get_send_status',{operation:'send_text',idempotencyKey:'expires'})).structuredContent.data.outcome).toBe('not_found');
    expect((await call('send_text', args)).structuredContent.data.messageId).toBe('SENT-2');
    expect(sent).toBe(2);
  });

  it('hashes normalized media arguments and keeps only an operational result', async () => {
    const first = await call('send_media', { to: '5511999999999', mimeType: 'IMAGE/PNG', dataBase64: ' dGVzdC1pbWFnZQ\n', caption: 'private-caption', fileName: 'private-name.png', idempotencyKey: 'media' });
    const repeated = await call('send_media', { to: '5511999999999', mimeType: 'image/png', dataBase64: 'dGVzdC1pbWFnZQ==', caption: 'private-caption', fileName: 'private-name.png', idempotencyKey: 'media' });
    expect(first.isError).toBeFalsy();
    expect(repeated).toEqual(first);
    expect(sent).toBe(1);
    const records = JSON.stringify((await local.db.prepare('SELECT * FROM send_operations').all()).results);
    expect(records).not.toMatch(/private-caption|private-name|dGVzdC1pbWFnZQ|test-image|instance-secret/);
    expect(records).toContain('SENT-1');
  });

  it.each([
    ['send_text', { to: '5511999999999', text: 'Sem chave' }],
    ['reply_to_message', { to: '5511999999999', text: 'Resposta', messageId: 'SOURCE' }],
    ['forward_message', { to: '5511999999999', conversationId: '5511888888888', messageId: 'SOURCE' }],
    ['send_media', { to: '5511999999999', mimeType: 'image/png', dataBase64: btoa('test-image') }],
  ])('preserves independent sends without a key for %s', async (name, args) => {
    expect((await call(name, args)).structuredContent.data.messageId).toBe('SENT-1');
    expect((await call(name, args)).structuredContent.data.messageId).toBe('SENT-2');
    expect(sent).toBe(2);
    expect((await local.db.prepare('SELECT COUNT(*) AS count FROM send_operations').first<{ count: number }>())?.count).toBe(0);
  });
});

it.each([
  ['send_text', {to:'5511999999999',text:'fixture'}],
  ['reply_to_message', {to:'5511999999999',text:'fixture',messageId:'SOURCE'}],
  ['forward_message', {to:'5511999999999',conversationId:'5511888888888',messageId:'SOURCE'}],
  ['send_media', {to:'5511999999999',mimeType:'image/png',dataBase64:btoa('fixture')}],
])('preserves an accepted %s ID even when audit storage fails', async (operation, args) => {
  await local.db.prepare("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'private audit failure'); END").run();
  const result = await call(operation, {...args,idempotencyKey:'audit-fixture'});
  expect(result.structuredContent.data).toMatchObject({accepted:true,messageId:'SENT-1',outcome:'accepted'});
  expect(result.isError).not.toBe(true);
  expect(sent).toBe(1);
});

it('scopes read-only send lookup to the authenticated owner and never dispatches', async () => {
  await call('send_text',{to:'5511999999999',text:'fixture',idempotencyKey:'lookup-owner'});
  const before = sent;
  const accepted = await call('get_send_status',{operation:'send_text',idempotencyKey:'lookup-owner'},user,['mcp:read']);
  expect(accepted.structuredContent.data).toMatchObject({outcome:'accepted',messageId:'SENT-1'});
  const other = {id:'other-claim',email:'other@example.test',claims:{}};
  const owner = await bootstrapLocalUser(local.db,other);
  await createConnection(local.db,encryptionKey,{userId:owner.id,friendlyName:'Other',instanceId:'other-instance',token:'other-token'});
  const foreign = await call('get_send_status',{operation:'send_text',idempotencyKey:'lookup-owner',connectionId},other);
  expect(foreign.structuredContent.data.error.code).toBe('connection_not_found');
  const missing = await call('get_send_status',{operation:'send_text',idempotencyKey:'lookup-owner'},other);
  expect(missing.structuredContent.data.outcome).toBe('not_found');
  expect(sent).toBe(before);
});

it('sanitizes corrupt stored send receipts and unavailable lookup storage', async () => {
  await call('send_text',{to:'5511999999999',text:'fixture',idempotencyKey:'corrupt'});
  await local.db.prepare("UPDATE send_operations SET result_json = ?").bind(JSON.stringify({accepted:true,messageId:42,token:'private-lookup-value'})).run();
  const corrupt = await call('get_send_status',{operation:'send_text',idempotencyKey:'corrupt'});
  expect(corrupt.structuredContent.data.error.code).toBe('send_idempotency_unavailable');
  expect(JSON.stringify(corrupt)).not.toContain('private-lookup-value');
  await local.db.prepare('DROP TABLE send_operations').run();
  const unavailable = await call('get_send_status',{operation:'send_text',idempotencyKey:'corrupt'});
  expect(unavailable.structuredContent.data.error.code).toBe('send_idempotency_unavailable');
  expect(sent).toBe(1);
});

it('logs an opaque key hash and outcome without the key, text or credential', async () => {
  const log = vi.spyOn(console,'info').mockImplementation(()=>{});
  await call('send_text',{to:'5511999999999',text:'private-message-fixture',idempotencyKey:'private-key-fixture'});
  const output = JSON.stringify(log.mock.calls);
  expect(output).toContain('clientMessageIdHash');
  expect(output).toContain('providerLatencyMs');
  expect(output).not.toMatch(/private-message-fixture|private-key-fixture|instance-secret/);
});

it('looks up the recorded result even when the instance encryption key is unavailable', async () => {
  await call('send_text',{to:'5511999999999',text:'fixture',idempotencyKey:'without-key'});
  env.TOKEN_ENCRYPTION_KEY = 'invalid-key';
  const result = await call('get_send_status',{operation:'send_text',idempotencyKey:'without-key'});
  expect(result.structuredContent.data).toMatchObject({connectionId,outcome:'accepted',messageId:'SENT-1'});
  expect(sent).toBe(1);
});
