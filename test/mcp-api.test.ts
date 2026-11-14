import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { z } from 'zod';
import { createMcpHandler, PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { createMcpServer } from '../src/lib/mcp';
import { createConnection, bootstrapLocalUser } from '../src/lib/db';
import { createTestD1 } from './helpers/local-d1';
import { sendMessageInput, expandSendMessage } from '../src/lib/send-message';
import type { Env } from '../src/types';

const user = { id: 'api', email: 'api@example.test', claims: {} };
const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
let local: Awaited<ReturnType<typeof createTestD1>>;
let env: Env;
let connectionId: string;
let resource: Record<string, unknown>;
let fetcher: MockInstance<typeof fetch>;
async function rpc(method: string, params: Record<string, unknown> = {}) {
  const handler = createMcpHandler(() => createMcpServer(env, user), { legacy: 'reject', responseMode: 'json' });
  const response = await handler.fetch(new Request('https://mcp.invalid/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(method === 'tools/call' ? { 'Mcp-Name': String(params.name) } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: { [PROTOCOL_VERSION_META_KEY]: '2026-07-28', [CLIENT_INFO_META_KEY]: { name: 'api-tests', version: '1' }, [CLIENT_CAPABILITIES_META_KEY]: {} } } }),
  }), { authInfo: { token: 'synthetic', clientId: 'client', scopes: ['mcp:read', 'mcp:write'] } });
  return z.object({ result: z.looseObject({ isError: z.boolean().optional(), structuredContent: z.object({ data: z.unknown() }).optional(), tools: z.array(z.looseObject({ name: z.string() })).optional() }) }).parse(await response.json()).result;
}
const call = (name: string, args: Record<string, unknown> = {}) => rpc('tools/call', { name, arguments: args });
beforeEach(async () => {
  local = await createTestD1();
  const owner = await bootstrapLocalUser(local.db, user);
  connectionId = (await createConnection(local.db, key, { userId: owner.id, friendlyName: 'Personal', instanceId: 'synthetic', token: 'synthetic-token' })).id;
  env = { DB: local.db, TOKEN_ENCRYPTION_KEY: key, EVOLUTION_BASE_URL: 'https://provider.invalid' };
  resource = { type: 'message', id: 'm1', attributes: { encodingFormat: 'text/plain', status: 'Read', body: { text: 'hello' } } };
  fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ jsonapi: { version: '1.1' }, data: resource }));
});
afterEach(async () => { vi.restoreAllMocks(); await local.dispose(); });
it('publishes exactly five tools and no gallery resource', async () => {
  expect((await rpc('tools/list')).tools?.map(t => t.name)).toEqual(['search_connections', 'search_groups', 'search_messages', 'get_message', 'send_message']);
  expect(JSON.stringify(await rpc('resources/list'))).not.toContain('image-gallery');
});
it('returns the latest retained delivery status without downloading media', async () => {
  expect(await call('get_message', { messageId: 'm1' })).toMatchObject({ structuredContent: { data: { connectionId, message: { status: 'Read', text: 'hello' } } } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([
  ['search_connections', { offset: -1 }], ['search_groups', { limit: 101 }],
  ['search_messages', { offset: 175, limit: 26 }], ['search_messages', { limit: 51 }],
  ['get_message', { page: 1, pages: [2], encodingFormat: 'image/*' }],
  ['get_message', { pages: [1, 2], crop: { x: 0, y: 0, width: 1, height: 1 }, encodingFormat: 'image/*' }],
  ['get_message', { crop: { x: .8, y: 0, width: .5, height: 1 }, encodingFormat: 'image/*' }],
])('returns invalid_options before I/O for %s %j', async (name, options) => {
  expect(await call(name, { ...(name === 'get_message' ? { messageId: 'm1' } : {}), options })).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'invalid_options' } } } });
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(['application/pdf', 'image/*'])('rejects incompatible text encoding %s', async encodingFormat => {
  expect(await call('get_message', { messageId: 'm1', options: { encodingFormat } })).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'incompatible_encoding_format', message: expect.stringContaining('text/plain') } } } });
});
it.each(['metadata', 'poll-responses', 'event-responses', 'reactions'])('rejects unavailable include %s explicitly', async include => {
  expect(await call('get_message', { messageId: 'm1', options: { include: [include] } })).toMatchObject({ isError: true, structuredContent: { data: { error: { code: include === 'reactions' ? 'unsupported_include' : 'incompatible_include' } } } });
});
it('filters connections before slicing, and status is opt-in', async () => {
  expect(await call('search_connections', { options: { query: 'person', limit: 1 } })).toMatchObject({ structuredContent: { data: { items: [{ id: connectionId }], hasMore: false } } });
  expect(fetcher).not.toHaveBeenCalled();
});
it('maps compact send inputs to existing Status operations', () => {
  const parsed = sendMessageInput.parse({ message: { kind: 'text', text: 'Status' }, options: { to: 'status', customMessageId: 'known' } });
  expect(expandSendMessage(parsed)).toEqual({ kind: 'status_text', text: 'Status', customMessageId: 'known' });
  expect(JSON.stringify(z.toJSONSchema(sendMessageInput))).not.toContain('status_text');
});
it('looks up an unknown send without decrypting credentials or dispatching', async () => {
  expect(await call('get_message', { options: { idempotencyKey: 'unknown-key' } })).toMatchObject({ structuredContent: { data: { connectionId, outcome: 'not_found' } } });
  expect(fetcher).not.toHaveBeenCalled();
});
it('filters groups before pagination and makes participants opt-in', async () => {
  fetcher.mockImplementation(async () => Response.json({ jsonapi: { version: '1.1' }, data: [
    { type: 'chat', id: 'a@g.us', attributes: { subject: 'Other' } },
    { type: 'chat', id: 'b@g.us', attributes: { subject: 'Team one' }, relationships: { participants: { data: [{ type: 'chat', id: 'member' }] } } },
    { type: 'chat', id: 'c@g.us', attributes: { subject: 'Team two' } },
  ] }));
  const result = await call('search_groups', { options: { query: 'team', limit: 1 } });
  expect(result).toMatchObject({ structuredContent: { data: { items: [{ id: 'b@g.us' }], hasMore: true } } });
  expect(JSON.stringify(result)).not.toContain('participants');
  expect(await call('search_groups', { options: { query: 'team', limit: 1, include: ['participants'] } })).toMatchObject({ structuredContent: { data: { items: [{ participants: [{ jid: 'member' }] }] } } });
});
it('reads an offset window beyond the provider per-request limit using before', async () => {
  const messages = Array.from({ length: 160 }, (_, i) => ({ type: 'message', id: `m${i}`, attributes: { at: 1800000000000 - i * 1000, encodingFormat: 'text/plain', body: { text: 'bounded' } } }));
  fetcher.mockImplementation(async input => {
    const url = new URL(String(input));
    expect(url.searchParams.has('offset')).toBe(false);
    expect(Number(url.searchParams.get('limit'))).toBeLessThanOrEqual(50);
    const before = Number(url.searchParams.get('before') ?? Infinity);
    return Response.json({ jsonapi: { version: '1.1' }, data: messages.filter(m => m.attributes.at < before).slice(0, Number(url.searchParams.get('limit'))) });
  });
  expect(await call('search_messages', { options: { offset: 100, limit: 25 } })).toMatchObject({ structuredContent: { data: { items: Array.from({ length: 25 }, (_, i) => ({ id: `m${100 + i}` })), hasMore: true } } });
  expect(fetcher.mock.calls.length).toBeGreaterThan(1);
});
it('reads event responses through the existing authorized relation and slices offset', async () => {
  resource = { type: 'message', id: 'm1', attributes: { body: { event: { name: 'Meeting' } } }, relationships: { eventResponses: { links: { related: '/messages/m1/event-responses' } } } };
  fetcher.mockImplementation(async input => {
    const url = new URL(String(input));
    if (url.pathname === '/message/status') return Response.json({ jsonapi: { version: '1.1' }, data: resource });
    expect(url.pathname).toBe('/messages/m1/event-responses');
    return Response.json({ jsonapi: { version: '1.1' }, data: [0, 1].map(i => ({ type: 'event-response', id: `r${i}`, attributes: { eventMessageId: 'm1', respondentJid: `person${i}`, responseMessageId: `reply${i}`, response: 'GOING', timestampMS: 1 } })), links: {}, meta: { coverage: 'observed' } });
  });
  expect(await call('get_message', { messageId: 'm1', options: { include: ['event-responses'], offset: 1, limit: 1 } })).toMatchObject({ structuredContent: { data: { 'event-responses': { items: [{ id: 'r1' }], hasMore: false, meta: { coverage: 'observed' } } } } });
});
it('fetches live status only on request and returns no raw provider credentials', async () => {
  fetcher.mockImplementation(async input => {
    expect(new URL(String(input)).pathname).toBe('/instance/status');
    return Response.json({ jsonapi: { version: '1.1' }, data: { type: 'connection', attributes: { connected: true, loggedIn: true, token: 'private-instance-key' }, meta: { instanceToken: 'private-meta-key' } } });
  });
  const result = await call('search_connections', { options: { include: ['status'] } });
  expect(result).toMatchObject({ structuredContent: { data: { items: [{ status: { state: 'connected' } }] } } });
  expect(JSON.stringify(result)).not.toContain('private-');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('resolves quoted messages on the same connection and redacts attachment URLs', async () => {
  fetcher.mockImplementation(async (_input, init) => {
    const request = z.object({ data: z.object({ id: z.string() }) }).parse(JSON.parse(String(init?.body)));
    return Response.json({ jsonapi: { version: '1.1' }, data: request.data.id === 'm1' ? { type: 'message', id: 'm1', attributes: { encodingFormat: 'text/plain', body: { text: 'reply' } }, meta: { quotedId: 'original' } } : { type: 'message', id: 'original', attributes: { encodingFormat: 'image/png', body: { text: 'caption', media: { url: 'https://private.invalid/file', encodingFormat: 'image/png' } } } } });
  });
  const result = await call('get_message', { messageId: 'm1', options: { include: ['quoted'] } });
  expect(result).toMatchObject({ structuredContent: { data: { quoted: { id: 'original', text: 'caption', media: { mimeType: 'image/png' } } } } });
  expect(JSON.stringify(result)).not.toContain('private.invalid');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
