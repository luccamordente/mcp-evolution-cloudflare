import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMcpHandler, PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { createMcpServer } from '../src/lib/mcp';
import { bootstrapLocalUser, createConnection } from '../src/lib/db';
import { createTestD1 } from './helpers/local-d1';
import type { Env } from '../src/types';

const fixtureSchema = z.object({ url: z.url(), token: z.string(), instanceId: z.string(), otherToken: z.string(), otherInstanceId: z.string(), controlToken: z.string(), chat: z.string() });
const messageSchema = z.object({
  id: z.string(), observation: z.object({ version: z.number(), state: z.string(), observedAt: z.number(), timestampSource: z.string() }).optional(),
  delivery: z.object({ version: z.number(), state: z.string(), at: z.number() }).optional(),
  source: z.string().optional(), timestamp: z.string().optional(), direction: z.string().optional(), type: z.string().optional(), messageType: z.string().optional(),
  contentUnavailable: z.boolean().optional(), contentUnavailableReason: z.string().optional(), text: z.string().optional(),
}).loose();
const resultSchema = z.object({ result: z.object({
  isError: z.boolean().optional(), content: z.array(z.object({ type: z.string() }).loose()),
  structuredContent: z.object({ data: z.object({
    connectionId: z.string().optional(), encodingFormat: z.string().optional(), message: messageSchema.optional(), quoted: messageSchema.nullable().optional(),
    items: z.array(messageSchema).optional(), hasMore: z.boolean().optional(), partial: z.boolean().optional(),
    error: z.object({ code: z.string(), status: z.number(), retryable: z.boolean() }).loose().optional(),
    availability: z.object({ state: z.string(), reason: z.string(), message: z.string(), recovery: z.object({ action: z.string(), tool: z.string(), steps: z.array(z.string()) }) }).optional(),
  }).loose() }),
}) });
const fixtureJSON = process.env.WAPILOT_OBSERVATION_FIXTURE;
const principal = { id: 'observation-acceptance', email: 'observation@example.test', claims: {} };
const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
let fixture: z.infer<typeof fixtureSchema>;
let local: Awaited<ReturnType<typeof createTestD1>>;
let env: Env;
let connectionId: string;
let otherConnectionId: string;
let foreignConnectionId: string;

async function call(name: 'get_message' | 'search_messages', args: Record<string, unknown>, selectedConnection = connectionId) {
  const options = z.record(z.string(), z.unknown()).parse(args.options ?? {});
  const handler = createMcpHandler(() => createMcpServer(env, principal), { legacy: 'reject', responseMode: 'json' });
  const response = await handler.fetch(new Request('https://mcp.invalid/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': name },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { ...args, options: { connectionId: selectedConnection, ...options } }, _meta: {
      [PROTOCOL_VERSION_META_KEY]: '2026-07-28', [CLIENT_INFO_META_KEY]: { name: 'observation-acceptance', version: '1' }, [CLIENT_CAPABILITIES_META_KEY]: {},
    } } }),
  }), { authInfo: { token: 'synthetic-mcp-read', clientId: 'observation-acceptance', scopes: ['mcp:read'] } });
  expect(response.status).toBe(200);
  return resultSchema.parse(await response.json()).result;
}

type FixtureEvent = { reopen: true } | { repair: 'classify_receipt' | 'restore_original' } | { id: string; state: 'receipt_only' | 'pending_decryption' | 'original_received'; fail?: true };

async function event(value: FixtureEvent) {
  const response = await fetch(`${fixture.url}/fixture/event`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fixture-Token': fixture.controlToken }, body: JSON.stringify(value) });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
}

function pending(result: z.infer<typeof resultSchema>['result'], state: 'receipt_only' | 'pending_decryption', deliveryAt = 1794793600123) {
  expect(result.isError).not.toBe(true);
  const data = result.structuredContent.data;
  expect(data.error).toBeUndefined();
  expect(data.encodingFormat).toBe('application/json');
  expect(data.message).toMatchObject({ observation: { version: 1, state, observedAt: 1794790925123, timestampSource: state === 'receipt_only' ? 'receipt' : 'message' }, contentUnavailable: true, contentUnavailableReason: state, messageType: 'unknown' });
  expect(data.message?.type).toBeUndefined();
  expect(data.message?.text).toBeUndefined();
  expect(data.availability).toEqual({
    state, reason: state,
    message: state === 'receipt_only'
      ? 'WaPilot observed a delivery or read receipt for this message ID, but has not observed the original message in this connection. This record is not message content.'
      : 'WaPilot observed the message, but its content is awaiting decryption. Content may become available after WhatsApp resends the message; recovery is not guaranteed.',
    recovery: { action: 'inspect_message', tool: 'get_message', steps: ['Keep the same connection and message ID. You may inspect this state again later. Do not automatically resend the message or repeatedly request content processing.'] },
  });
  if (state === 'receipt_only') {
    expect(data.message).toMatchObject({ direction: 'unknown', delivery: { version: 1, state: 'read', at: deliveryAt } });
    expect(data.message?.source).toBeUndefined();
    expect(data.message?.timestamp).toBeUndefined();
  } else {
    expect(data.message).toMatchObject({ direction: 'inbound', source: '15550000001', timestamp: '2026-11-16T00:46:40.000Z' });
  }
}

describe.runIf(Boolean(fixtureJSON))('same-row observation through real MCP, Go HTTP and PostgreSQL', () => {
  beforeAll(async () => {
    fixture = fixtureSchema.parse(JSON.parse(fixtureJSON ?? 'null'));
    expect(new URL(fixture.url).hostname).toBe('127.0.0.1');
    local = await createTestD1();
    const owner = await bootstrapLocalUser(local.db, principal);
    const foreign = await bootstrapLocalUser(local.db, { id: 'foreign', email: 'foreign@example.test', claims: {} });
    connectionId = (await createConnection(local.db, key, { userId: owner.id, friendlyName: 'Observation owner', instanceId: fixture.instanceId, token: fixture.token })).id;
    otherConnectionId = (await createConnection(local.db, key, { userId: owner.id, friendlyName: 'Other instance', instanceId: fixture.otherInstanceId, token: fixture.otherToken })).id;
    foreignConnectionId = (await createConnection(local.db, key, { userId: foreign.id, friendlyName: 'Foreign connection', instanceId: fixture.instanceId, token: fixture.token })).id;
    env = { DB: local.db, TOKEN_ENCRYPTION_KEY: key, EVOLUTION_BASE_URL: fixture.url, ENVIRONMENT: 'local' };
  });
  afterAll(async () => local?.dispose());

  it('filters receipt-only rows before limits and traverses receipt-only pages on explicit inspection', async () => {
    const normal = await call('search_messages', { options: { limit: 50 } });
    expect(normal.isError).not.toBe(true);
    expect(normal.structuredContent.data.items).toHaveLength(15);
    expect(normal.structuredContent.data.items?.some(item => item.observation?.state === 'receipt_only')).toBe(false);
    expect(normal.structuredContent.data.items?.map(item => item.id)).toEqual(expect.arrayContaining(['pending', ...Array.from({ length: 8 }, (_, i) => `legacy-${i}`)]));
    const first = await call('search_messages', { options: { includeReceiptOnly: true, offset: 0, limit: 50 } });
    expect(first.structuredContent.data.items).toHaveLength(50);
    expect(first.structuredContent.data.hasMore).toBe(true);
    expect(first.structuredContent.data.items?.every(item => item.observation?.state === 'receipt_only')).toBe(true);
    const second = await call('search_messages', { options: { includeReceiptOnly: true, offset: 50, limit: 50 } });
    const ids = [...first.structuredContent.data.items ?? [], ...second.structuredContent.data.items ?? []].map(item => item.id);
    expect(ids).toHaveLength(73);
    expect(new Set(ids).size).toBe(73);
    expect(second.structuredContent.data.hasMore).toBe(false);
    expect(ids).toEqual(expect.arrayContaining(Array.from({ length: 55 }, (_, i) => `page-${String(i).padStart(2, '0')}`)));
  });

  it.each(['receipt_only', 'pending_decryption'] as const)('returns successful JSON state for %s and refuses content processing with 409', async state => {
    const messageId = state === 'receipt_only' ? 'receipt' : 'pending';
    pending(await call('get_message', { messageId }), state);
    for (const encodingFormat of ['image/*', 'application/pdf', 'audio/mpeg', 'application/octet-stream']) {
      const result = await call('get_message', { messageId, options: { encodingFormat } });
      expect(result).toMatchObject({ isError: true, structuredContent: { data: { partial: true, message: { observation: { state } }, availability: { state }, error: { code: 'message_content_pending', status: 409, retryable: false } } } });
      expect(result.content.every(item => item.type === 'text')).toBe(true);
    }
    const optional = await call('get_message', { messageId, options: { include: ['transcript', 'document-text'] } });
    expect(optional).toMatchObject({ isError: true, structuredContent: { data: { encodingFormat: 'application/json', partial: true, message: { observation: { state } }, availability: { state }, error: { code: 'message_content_pending', status: 409, retryable: false } } } });
  });

  it('keeps quoted receipt and pending observations readable without fabricating identity', async () => {
    for (const [messageId, state] of [['parent', 'receipt_only'], ['parent-pending', 'pending_decryption']]) {
      const result = await call('get_message', { messageId, options: { include: ['quoted'] } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.data.message?.text).toBe('synthetic original');
      expect(result.structuredContent.data.quoted).toMatchObject({ observation: { state }, contentUnavailable: true });
      expect(result.structuredContent.data.quoted?.text).toBeUndefined();
      if (state === 'receipt_only') {
        expect(result.structuredContent.data.quoted?.source).toBeUndefined();
        expect(result.structuredContent.data.quoted?.timestamp).toBeUndefined();
      }
    }
  });

  it('distinguishes legacy, unknown and invalid markers, unretained originals, missing IDs and authorized scopes', async () => {
    for (const messageId of ['not-retained', ...Array.from({ length: 8 }, (_, i) => `legacy-${i}`)]) {
      const result = await call('get_message', { messageId });
      expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'message_content_unavailable', status: 404 } } } });
      expect(result.structuredContent.data.availability).toBeUndefined();
    }
    for (const [messageId, connection] of [['missing', connectionId], ['receipt', otherConnectionId]]) {
      expect(await call('get_message', { messageId }, connection)).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'message_not_found', status: 404 } } } });
    }
    const foreign = await call('get_message', { messageId: 'receipt' }, foreignConnectionId);
    expect(foreign.isError).toBe(true);
    expect(foreign.structuredContent.data.message).toBeUndefined();
    const other = await call('search_messages', {}, otherConnectionId);
    expect(other.structuredContent.data.items).toEqual([]);
    for (const token of ['', 'synthetic-admin', 'invalid']) {
      expect((await fetch(`${fixture.url}/message/search`, { headers: { apikey: token } })).status).toBe(401);
    }
  });

  it('promotes the same row across receipt, pending and original events while preserving read status after duplicates and reopen', async () => {
    await event({ reopen: true });
    pending(await call('get_message', { messageId: 'pending' }), 'pending_decryption');
    await event({ id: 'receipt-pending-original', state: 'pending_decryption' });
    expect((await call('get_message', { messageId: 'receipt-pending-original' })).structuredContent.data.message).toMatchObject({ observation: { state: 'pending_decryption' }, delivery: { state: 'read' } });
    await event({ id: 'receipt-original', state: 'original_received', fail: true });
    pending(await call('get_message', { messageId: 'receipt-original' }), 'receipt_only');
    for (const id of ['receipt-original', 'receipt-pending-original', 'original-receipt', 'original-pending']) {
      const assertOriginal = async (deliveryKnown = true) => {
        const result = await call('get_message', { messageId: id });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent.data.error).toBeUndefined();
        expect(result.structuredContent.data.availability).toBeUndefined();
        expect(result.structuredContent.data.message).toMatchObject({ id, text: 'synthetic original', direction: 'inbound', source: '15550000001', timestamp: '2026-11-16T00:46:40.000Z', observation: { state: 'original_received', timestampSource: 'message', observedAt: id.startsWith('original-') ? 1794790925123 : 1794790926000 } });
        if (deliveryKnown) expect(result.structuredContent.data.message?.delivery).toMatchObject({ state: 'read', at: 1794793600123 });
        else expect(result.structuredContent.data.message?.delivery).toBeUndefined();
      };
      if (id === 'original-pending') {
        await event({ id, state: 'pending_decryption' });
        await assertOriginal(false);
      } else {
        await event({ id, state: id === 'original-receipt' ? 'receipt_only' : 'original_received' });
        await assertOriginal();
      }
      await event({ id, state: 'receipt_only' });
      await assertOriginal();
      await event({ id, state: 'pending_decryption' });
      await assertOriginal();
      await event({ id, state: 'original_received' });
      await event({ reopen: true });
      await assertOriginal();
    }
  });

  it('reads a destination row through MCP after real CLI classification and explicit restoration', async () => {
    await event({ repair: 'classify_receipt' });
    pending(await call('get_message', { messageId: 'repair-row' }), 'receipt_only', 1794793600000);
    const classified = await call('search_messages', { options: { limit: 50 } });
    expect(classified.structuredContent.data.items?.some(item => item.id === 'repair-row')).toBe(false);
    await event({ repair: 'restore_original' });
    await event({ reopen: true });
    const restored = await call('get_message', { messageId: 'repair-row' });
    expect(restored.isError).not.toBe(true);
    expect(restored.structuredContent.data.message).toMatchObject({ id: 'repair-row', text: 'synthetic original', direction: 'outbound', source: '15550000001', timestamp: '2026-11-16T00:46:40.000Z', observation: { state: 'original_received' }, delivery: { state: 'read', at: 1794793600000 } });
    const listing = await call('search_messages', { options: { conversationId: fixture.chat, limit: 50 } });
    expect(listing.structuredContent.data.items?.filter(item => item.id === 'repair-row')).toHaveLength(1);
  });

  it('records real authenticated provider requests, unchanged schema and same-row cardinality', async () => {
    const response = await fetch(`${fixture.url}/fixture/evidence`, { headers: { 'X-Fixture-Token': fixture.controlToken } });
    expect(response.status).toBe(200);
    const evidence = z.object({ requests: z.record(z.string(), z.number()), schemaUnchanged: z.literal(true), identitiesUnchanged: z.literal(true), initialRows: z.number(), rows: z.number(), statuses: z.array(z.string()), reopens: z.number(), failedWrites: z.number(), repairOperations: z.array(z.string()) }).parse(await response.json());
    expect(evidence.rows).toBe(evidence.initialRows);
    expect(evidence.rows).toBe(74);
    expect(evidence.reopens).toBe(6);
    expect(evidence.failedWrites).toBe(1);
    expect(evidence.statuses).toEqual(['Read', 'Read', 'Read', 'Read', 'Read']);
    expect(evidence.repairOperations).toEqual(['classify_receipt', 'restore_original']);
    expect(evidence.requests['POST /message/status']).toBeGreaterThan(30);
    expect(Object.keys(evidence.requests).some(path => path.includes('includeReceiptOnly=true') && path.includes('before='))).toBe(true);
    expect(Object.keys(evidence.requests).every(path => path.startsWith('GET /message/search') || path === 'POST /message/status')).toBe(true);
    console.info(JSON.stringify({ event: 'message_observation_connected_acceptance', ...evidence }));
  });
});
