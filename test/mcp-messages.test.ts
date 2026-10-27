import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpHandler, PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { createMcpServer } from '../src/lib/mcp';
import { encryptToken } from '../src/lib/crypto';
import type { ConnectionRecord, Env } from '../src/types';

const connectionId = 'c770126e-773a-408f-9405-89561d05447c';
const workConnectionId = '1ead118b-0cf7-4d7f-8765-229a800ed5e9';
const foreignConnectionId = 'a2b4b953-a4ed-4da8-8f35-bfb966029c58';
const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const retainedMessage = {
  type: 'message', id: 'message-1',
  attributes: { at: 1792058400000, encodingFormat: 'text/plain', body: { text: 'Reunião amanhã' } },
  meta: { chat: '5511999999999', fromMe: false },
  relationships: { author: { data: { type: 'chat', id: '5511999999999' } } },
};

async function messageTool() {
  const connection: ConnectionRecord = {
    id: connectionId, userId: 'db-user-a', friendlyName: 'Personal', instanceId: 'instance-a',
    encryptedToken: await encryptToken('instance-secret', encryptionKey),
    createdAt: '2026-10-17', updatedAt: '2026-10-17',
  };
  const connections: ConnectionRecord[] = [
    connection,
    { ...connection, id: workConnectionId, instanceId: 'instance-work', encryptedToken: await encryptToken('work-instance-secret', encryptionKey) },
    { ...connection, id: foreignConnectionId, userId: 'db-user-b', encryptedToken: await encryptToken('foreign-instance-secret', encryptionKey) },
  ];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (sql.startsWith('SELECT id, email FROM users')) return { id: 'db-user-a', email: values[0] };
              if (sql.includes('FROM whatsapp_connections WHERE id = ?1 AND user_id = ?2')) {
                return connections.find((item) => values[0] === item.id && values[1] === item.userId) ?? null;
              }
              return null;
            },
            async all() {
              return { results: sql.includes('FROM whatsapp_connections WHERE user_id = ?1 AND is_default = 1') && values[0] === connection.userId ? [connection] : [] };
            },
            async run() { return { meta: { changes: 1 } }; },
          };
        },
      };
    },
  };
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ jsonapi: { version: '1.1' }, data: [retainedMessage] }));
  const env = { DB: db as unknown as D1Database, TOKEN_ENCRYPTION_KEY: encryptionKey, EVOLUTION_BASE_URL: 'https://evolution.invalid', EVOLUTION_GLOBAL_API_KEY: 'global-secret' } as Env;
  const handler = createMcpHandler(() => createMcpServer(env, { id: 'claim-user-a', email: 'a@example.test', claims: {} }), { legacy: 'reject', responseMode: 'json' });
  async function rpc<T = { isError?: boolean; content: Array<{ type: string; text: string }>; structuredContent: { data: unknown } }>(method: string, params: Record<string, unknown> = {}) {
    const response = await handler.fetch(new Request('https://mcp.invalid/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(method === 'tools/call' ? { 'Mcp-Name': 'list_messages' } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: {
        [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
        [CLIENT_INFO_META_KEY]: { name: 'message-tests', version: '1.0.0' },
        [CLIENT_CAPABILITIES_META_KEY]: {},
      } } }),
    }));
    return response.json() as Promise<{ result: T }>;
  }
  return { fetcher, rpc, call: (args: Record<string, unknown>) => rpc('tools/call', { name: 'list_messages', arguments: args }) };
}

afterEach(() => vi.restoreAllMocks());

describe('list_messages retained conversation search', () => {
  it('advertises an optional conversation filter distinct from the connection selector', async () => {
    const { rpc, fetcher } = await messageTool();
    const { result } = await rpc<{ tools: Array<{ name: string; description: string; inputSchema: { required?: string[]; properties: Record<string, { description: string }> }; annotations: { readOnlyHint: boolean } }> }>('tools/list');
    const tool = result.tools.find((item) => item.name === 'list_messages')!;
    expect(tool.inputSchema.properties.conversationId.description).toMatch(/contact number.*individual.*group.*JID/i);
    expect(tool.inputSchema.properties.conversationId.description).toContain('connectionId');
    expect(tool.inputSchema.required ?? []).not.toContain('conversationId');
    expect(tool.description).toContain('conversationId');
    expect(tool.description).toContain('connectionId');
    expect(tool.description).toMatch(/partial|complete historical archive/);
    expect(tool.description).not.toMatch(/evolution|upstream|downstream/i);
    expect(tool.annotations.readOnlyHint).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('combines a contact number, text and limit in the selected connection request', async () => {
    const { call, fetcher } = await messageTool();
    const response = await call({ conversationId: '5511999999999', text: 'Reunião', limit: 10 });
    expect(response.result).toMatchObject({ structuredContent: { data: { items: [{ id: 'message-1', text: 'Reunião amanhã', conversationId: '5511999999999', sender: '5511999999999', timestamp: '2026-10-15T10:00:00.000Z', type: 'text/plain' }], hasMore: false } } });
    const request = new URL(String(fetcher.mock.calls[0][0]));
    expect(request.pathname).toBe('/message/search');
    expect(Object.fromEntries(request.searchParams)).toEqual({ chat: '5511999999999', q: 'Reunião', limit: '11' });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('apikey')).toBe('instance-secret');
    expect(JSON.parse(response.result.content[0].text)).toEqual(response.result.structuredContent.data);
  });

  it('trims a copied individual JID and searches without text using the default limit', async () => {
    const { call, fetcher } = await messageTool();
    await call({ conversationId: '  5511999999999@s.whatsapp.net  ' });
    expect(Object.fromEntries(new URL(String(fetcher.mock.calls[0][0])).searchParams)).toEqual({ chat: '5511999999999@s.whatsapp.net', limit: '26' });
  });

  it('selects an explicit owned connection before searching a group with the maximum limit', async () => {
    const { call, fetcher } = await messageTool();
    fetcher.mockResolvedValue(Response.json({ jsonapi: { version: '1.1' }, data: [{ ...retainedMessage, meta: { chat: '120363123456789@g.us', fromMe: false } }] }));
    const response = await call({ connectionId: workConnectionId, conversationId: '120363123456789@g.us', limit: 50 });
    expect(response.result.structuredContent.data).toMatchObject({ items: [{ conversationId: '120363123456789@g.us' }] });
    expect(Object.fromEntries(new URL(String(fetcher.mock.calls[0][0])).searchParams)).toEqual({ chat: '120363123456789@g.us', limit: '50' });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('apikey')).toBe('work-instance-secret');
  });

  it('does not query messages for a connection owned by another user', async () => {
    const { call, fetcher } = await messageTool();
    const response = await call({ connectionId: foreignConnectionId, conversationId: '5511999999999' });
    expect(response.result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'connection_not_found', status: 404, operation: 'list_messages' } } } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [{}, { limit: '26' }],
    [{ text: ' Reunião ' }, { q: 'Reunião', limit: '26' }],
  ])('preserves unfiltered searches for existing arguments %j', async (args, expectedQuery) => {
    const { call, fetcher } = await messageTool();
    const response = await call(args);
    expect(Object.fromEntries(new URL(String(fetcher.mock.calls[0][0])).searchParams)).toEqual(expectedQuery);
    expect(response.result.structuredContent.data).toMatchObject({ items: [{ id: 'message-1' }], hasMore: false });
  });

  it('preserves a sanitized error envelope for filtered searches', async () => {
    const { call, fetcher } = await messageTool();
    fetcher.mockResolvedValue(Response.json({ jsonapi: { version: '1.1' }, errors: [{ status: '401', title: 'Unauthorized', detail: 'token=private-value' }], meta: { privatePayload: 'hidden' } }, { status: 401 }));
    const response = await call({ conversationId: '5511999999999' });
    expect(response.result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'evolution_http_error', status: 401, retryable: false, operation: 'list_messages', message: 'token=[redacted]' } } } });
    expect(JSON.parse(response.result.content[0].text)).toEqual(response.result.structuredContent.data);
    expect(JSON.stringify(response)).not.toMatch(/private-value|privatePayload|hidden|instance-secret|global-secret/);
  });

  it('rejects an empty conversation identifier without querying all conversations', async () => {
    const { call, fetcher } = await messageTool();
    const response = await call({ conversationId: '   ' });
    expect(response.result.isError).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['', null, 5511999999999, true, {}, []])('rejects invalid conversation identifier %j before querying messages', async (conversationId) => {
    const { call, fetcher } = await messageTool();
    const response = await call({ conversationId });
    expect(response.result.isError).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects conversation identifiers longer than 200 characters', async () => {
    const { call, fetcher } = await messageTool();
    const response = await call({ conversationId: '1'.repeat(201) });
    expect(response.result.isError).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
