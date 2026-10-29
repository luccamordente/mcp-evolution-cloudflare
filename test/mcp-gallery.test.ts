import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpHandler, PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { createMcpServer } from '../src/lib/mcp';
import { encryptToken } from '../src/lib/crypto';
import { EvolutionApiError, EvolutionGoClient } from '../src/lib/evolution';
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

async function galleryTool(defaultCount = 1, origins = 'https://storage.example.test') {
  const auditBindings: unknown[][] = [];
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
              return { results: sql.includes('FROM whatsapp_connections WHERE user_id = ?1 AND is_default = 1') && values[0] === connection.userId ? Array.from({ length: defaultCount }, () => connection) : [] };
            },
            async run() { if (sql.includes('audit_log')) auditBindings.push(values); return { meta: { changes: 1 } }; },
          };
        },
      };
    },
  };
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ jsonapi: { version: '1.1' }, data: [retainedMessage] }));
  const env = { DB: db as unknown as D1Database, TOKEN_ENCRYPTION_KEY: encryptionKey, EVOLUTION_BASE_URL: 'https://evolution.invalid', EVOLUTION_GLOBAL_API_KEY: 'global-secret', IMAGE_STORAGE_ORIGINS: origins } as Env;
  const handler = createMcpHandler(() => createMcpServer(env, { id: 'claim-user-a', email: 'a@example.test', claims: {} }), { legacy: 'reject', responseMode: 'json' });
  async function rpc<T = { isError?: boolean; content: Array<{ type: string; text: string }>; structuredContent: { data: unknown }; _meta: { gallery: { connectionId: string; limit: number; items: Array<{ state: string; url?: string; direction?: string; caption?: string; id?: string }> } } }>(method: string, params: Record<string, unknown> = {}) {
    const response = await handler.fetch(new Request('https://mcp.invalid/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(method === 'tools/call' ? { 'Mcp-Name': String(params.name) } : method === 'resources/read' ? { 'Mcp-Name': String(params.uri) } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: {
        [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
        [CLIENT_INFO_META_KEY]: { name: 'message-tests', version: '1.0.0' },
        [CLIENT_CAPABILITIES_META_KEY]: {},
      } } }),
    }));
    return response.json() as Promise<{ result: T }>;
  }
  return { fetcher, rpc, auditBindings, setDefaultCount: (count: number) => { defaultCount = count; }, call: (args: Record<string, unknown>) => rpc('tools/call', { name: 'show_image_gallery', arguments: args }) };
}

afterEach(() => vi.restoreAllMocks());

describe('image gallery MCP boundary', () => {
  it('discovers the read-only tool and its readable static MCP App resource', async () => {
    const { rpc, fetcher } = await galleryTool();
    const { result } = await rpc<{ tools: Array<{ name: string; _meta: { ui: { resourceUri: string } }; annotations: { readOnlyHint: boolean }; inputSchema: { properties: Record<string, unknown> } }> }>('tools/list');
    const tool = result.tools.find(item => item.name === 'show_image_gallery')!;
    expect(tool).toBeDefined();
    expect(tool.annotations.readOnlyHint).toBe(true);
    expect(tool._meta.ui.resourceUri).toBe('ui://whatsapp/image-gallery-v2.html');
    const resource = await rpc<{ contents: Array<{ text: string; mimeType: string; _meta: { ui: { csp: { resourceDomains: string[]; connectDomains: string[] } } } }> }>('resources/read', { uri: tool._meta.ui.resourceUri });
    expect(resource.result.contents[0].mimeType).toBe('text/html;profile=mcp-app');
    expect(resource.result.contents[0].text).toContain('<!doctype html>');
    expect(resource.result.contents[0].text).toContain("img-src https://storage.example.test; connect-src 'none'");
    expect(resource.result.contents[0].text).toContain("script-src 'unsafe-inline'");
    expect(resource.result.contents[0].text).toContain("font-src 'none'");
    expect(resource.result.contents[0].text).toContain('SIL OPEN FONT LICENSE');
    expect(resource.result.contents[0].text).not.toContain('data:font/woff2');
    expect(resource.result.contents[0].text).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(resource.result.contents[0]._meta.ui.csp).toEqual({ resourceDomains: ['https://storage.example.test'], connectDomains: [], frameDomains: [], baseUriDomains: [] });
    expect(resource.result.contents[0].text).not.toMatch(/instance-secret|global-secret|db-user-a/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('queries image messages before the limit and keeps signed links solely in component metadata', async () => {
    const { call, fetcher, auditBindings } = await galleryTool();
    const image = (id: string, fromMe: boolean) => ({ ...retainedMessage, id, attributes: { ...retainedMessage.attributes, encodingFormat: 'image/jpeg', body: { text: '<img src=x onerror=alert(1)>', media: { url: `https://storage.example.test/${id}.jpg?signature=private-signed-value` } } }, meta: { chat: '5511999999999', fromMe } });
    fetcher.mockResolvedValue(Response.json({ jsonapi: { version: '1.1' }, data: [image('in', false), image('out', true)] }));
    const response = await call({ conversationId: ' 5511999999999 ', text: 'férias', limit: 7 });
    expect(response.result.isError).not.toBe(true);
    expect(Object.fromEntries(new URL(String(fetcher.mock.calls[0][0])).searchParams)).toEqual({ encodingFormat: 'image/*', identifier: '5511999999999', q: 'férias', limit: '8' });
    expect(response.result._meta.gallery).toMatchObject({ connectionId, limit: 7, items: [{ id: 'in', direction: 'inbound', state: 'ready', caption: '<img src=x onerror=alert(1)>', url: 'https://storage.example.test/in.jpg?signature=private-signed-value' }, { id: 'out', direction: 'outbound', state: 'ready' }] });
    expect(JSON.stringify({ content: response.result.content, structuredContent: response.result.structuredContent, auditBindings })).not.toMatch(/signature|private-signed-value|instance-secret|global-secret|onerror/);
    expect(response.result.structuredContent.data).toMatchObject({ count: 2, available: 2, unavailable: 0 });
  });

  it.each([
    ['https://storage.example.test/image.jpg?signature=ok', 'image/jpeg', 'ready'],
    [undefined, 'image/png', 'missing'],
    ['https://storage.example.test/image.svg', 'image/svg+xml', 'unsupported'],
    ['https://storage.example.test/image.html', 'text/html', 'unsupported'],
    ['https://storage.example.test/image.svg', 'image/jpeg', 'blocked'],
    ['https://attacker.example/image.jpg', 'image/jpeg', 'blocked'],
    ['https://storage.example.test.attacker.example/image.jpg', 'image/jpeg', 'blocked'],
    ['https://user:password@storage.example.test/image.jpg', 'image/jpeg', 'blocked'],
    ['http://storage.example.test/image.jpg', 'image/jpeg', 'blocked'],
    ['data:image/png;base64,AAAA', 'image/png', 'blocked'],
    ['javascript:alert(1)', 'image/png', 'blocked'],
  ])('isolates unavailable or unapproved media %s (%s)', async (url, mimeType, state) => {
    const { call, fetcher } = await galleryTool();
    fetcher.mockResolvedValue(Response.json({ jsonapi: { version: '1.1' }, data: [
      { ...retainedMessage, id: 'bad', attributes: { encodingFormat: mimeType, body: { media: { url } } } },
      { ...retainedMessage, id: 'good', attributes: { encodingFormat: 'image/png', body: { media: { url: 'https://storage.example.test/good.png' } } } },
    ] }));
    const { result } = await call({});
    expect(result._meta.gallery.items[0].state).toBe(state);
    expect(result._meta.gallery.items[1].state).toBe('ready');
    if (state !== 'ready') expect(result._meta.gallery.items[0].url).toBeUndefined();
  });

  it('returns useful empty fallback and keeps refresh pinned to the resolved connection', async () => {
    const { call, fetcher, setDefaultCount } = await galleryTool();
    fetcher.mockResolvedValue(Response.json({ jsonapi: { version: '1.1' }, data: [] }));
    const initial = await call({});
    expect(initial.result.structuredContent.data).toMatchObject({ count: 0, available: 0 });
    expect(initial.result.content[0].text).toContain('Partial retained');
    expect(initial.result._meta.gallery.connectionId).toBe(connectionId);
    expect(initial.result._meta.gallery.limit).toBe(12);
    fetcher.mockResolvedValue(Response.json({ jsonapi: { version: '1.1' }, data: [{ ...retainedMessage, attributes: { encodingFormat: 'image/jpeg', body: { media: { url: 'https://storage.example.test/renewed.jpg?signature=new' } } } }] }));
    setDefaultCount(2); // A changed default cannot silently move an existing gallery.
    const refreshed = await call({ connectionId: initial.result._meta.gallery.connectionId });
    expect(refreshed.result._meta.gallery.items[0].url).toContain('signature=new');
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('apikey')).toBe('instance-secret');
  });

  it('never crosses accounts even when message IDs coincide', async () => {
    const { call, fetcher } = await galleryTool();
    const owned = await call({ connectionId: workConnectionId });
    expect(owned.result._meta.gallery.connectionId).toBe(workConnectionId);
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('apikey')).toBe('work-instance-secret');
    fetcher.mockClear();
    const foreign = await call({ connectionId: foreignConnectionId });
    expect(foreign.result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'connection_not_found' } } } });
    expect(foreign.result._meta.gallery).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([[0, 'no_default_connection'], [2, 'multiple_default_connections']])('rejects default count %s before retrieving media', async (count, code) => {
    const { call, fetcher } = await galleryTool(Number(count));
    const { result } = await call({});
    expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { code } } } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([{ limit: 0 }, { limit: 21 }, { limit: 1.5 }, { conversationId: '' }, { conversationId: 'x'.repeat(201) }, { url: 'https://storage.example.test/injected.jpg' }])('rejects invalid gallery arguments %j', async (args) => {
    const { call, fetcher } = await galleryTool();
    expect((await call(args)).result.isError).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed for unapproved storage configuration in both CSP and results', async () => {
    const { rpc, call, fetcher } = await galleryTool(1, 'http://storage.example.test,https://*.example.test,https://storage.example.test/private,https://user:secret@storage.example.test');
    const resource = await rpc<{ contents: Array<{ text: string; _meta: { ui: { csp: { resourceDomains: string[] } } } }> }>('resources/read', { uri: 'ui://whatsapp/image-gallery-v2.html' });
    expect(resource.result.contents[0]._meta.ui.csp.resourceDomains).toEqual([]);
    expect(resource.result.contents[0].text).toContain("img-src 'none'");
    fetcher.mockResolvedValue(Response.json({ jsonapi: { version: '1.1' }, data: [{ ...retainedMessage, attributes: { encodingFormat: 'image/jpeg', body: { media: { url: 'https://storage.example.test/image.jpg' } } } }] }));
    expect((await call({})).result._meta.gallery.items[0]).toMatchObject({ state: 'blocked' });
  });

  it('sanitizes upstream storage errors in text, structured output and audit, then recovers on refresh', async () => {
    const { call, fetcher, auditBindings, setDefaultCount } = await galleryTool();
    fetcher.mockResolvedValue(Response.json({ jsonapi: { version: '1.1' }, errors: [{ detail: 'https://storage.example.test/image.jpg?signature=private-link token=private-token' }] }, { status: 401 }));
    const failed = await call({});
    expect(failed.result).toMatchObject({ isError: true, structuredContent: { data: { error: { status: 401, operation: 'show_image_gallery' } } } });
    expect(failed.result._meta.gallery).toMatchObject({ connectionId, limit: 12, items: [] });
    expect(auditBindings).toHaveLength(1);
    expect(JSON.stringify({ failed, auditBindings })).not.toMatch(/private-link|private-token|image.jpg|instance-secret|global-secret/);
    fetcher.mockResolvedValue(Response.json({ jsonapi: { version: '1.1' }, data: [] }));
    setDefaultCount(2);
    expect((await call({ connectionId: failed.result._meta.gallery.connectionId })).result.isError).not.toBe(true);
  });

  it.each(['wapilot', 'upstream'] as const)('preserves the %s timeout classification without forwarding private details', async (timeoutSource) => {
    const { call, auditBindings } = await galleryTool();
    vi.spyOn(EvolutionGoClient.prototype, 'listMessages').mockRejectedValue(new EvolutionApiError(504, 'WaPilot timeout test', { private: 'private-payload' }, timeoutSource));
    const { result } = await call({});
    expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: `${timeoutSource}_timeout`, status: 504, message: 'WaPilot timeout test' } } } });
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent.data);
    expect(JSON.stringify({ result, auditBindings })).not.toMatch(/private-payload|instance-secret|global-secret/);
    expect(auditBindings.some(values => values.some(value => typeof value === 'string' && value.includes(`${timeoutSource}_timeout`)))).toBe(true);
  });

  it('never authorizes direct image requests to the Evolution API origin', async () => {
    const { rpc } = await galleryTool(1, 'https://storage.example.test,https://evolution.invalid');
    const resource = await rpc<{ contents: Array<{ _meta: { ui: { csp: { resourceDomains: string[] } } } }> }>('resources/read', { uri: 'ui://whatsapp/image-gallery-v2.html' });
    expect(resource.result.contents[0]._meta.ui.csp.resourceDomains).toEqual(['https://storage.example.test']);
  });

});
