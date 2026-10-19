import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpHandler, PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { createMcpServer } from '../src/lib/mcp';
import { encryptToken } from '../src/lib/crypto';
import type { ConnectionRecord, Env } from '../src/types';

const connectionId = 'c770126e-773a-408f-9405-89561d05447c';
const otherConnectionId = 'a2b4b953-a4ed-4da8-8f35-bfb966029c58';
const workConnectionId = '1ead118b-0cf7-4d7f-8765-229a800ed5e9';
const conversationId = '5511999999999';
// Non-sensitive, decodable 1x1 PNG fixture.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const retainedImage = {
  type: 'message', id: 'image-1',
  attributes: { at: 1792058400000, encodingFormat: 'image/png', body: { text: 'Foto de teste', media: { url: 'https://storage.example.test/image.png?signature=private-signed-value' } } },
  meta: { chat: conversationId, fromMe: false },
  relationships: { author: { data: { type: 'chat', id: '5511999999999@s.whatsapp.net' } } },
};

interface SelectionResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  structuredContent: { data: { error?: { code: string; status: number; retryable: boolean; message: string } } };
  _meta?: { selection?: { content: Array<{ type: string; data: string; mimeType: string }>; message: Record<string, unknown> } };
}

async function selectionTool() {
  const auditBindings: unknown[][] = [];
  const connection: ConnectionRecord = {
    id: connectionId, userId: 'db-user-a', friendlyName: 'Personal', instanceId: 'instance-a',
    encryptedToken: await encryptToken('instance-secret', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
    createdAt: '2026-10-17', updatedAt: '2026-10-17',
  };
  const workConnection = { ...connection, id: workConnectionId, instanceId: 'instance-work', encryptedToken: await encryptToken('work-instance-secret', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') };
  let defaultConnection = connection;
  const db = {
    prepare(sql: string) {
      return { bind(...values: unknown[]) { return {
        async first() {
          if (sql.startsWith('SELECT id, email FROM users')) return { id: 'db-user-a', email: values[0] };
          if (sql.includes('FROM whatsapp_connections WHERE id = ?1 AND user_id = ?2')) return [connection, workConnection].find(item => values[0] === item.id && values[1] === item.userId) ?? null;
          return null;
        },
        async all() { return { results: sql.includes('FROM whatsapp_connections WHERE user_id = ?1 AND is_default = 1') && values[0] === connection.userId ? [defaultConnection] : [] }; },
        async run() { if (sql.includes('audit_log')) auditBindings.push(values); return { meta: { changes: 1 } }; },
      }; } };
    },
  };
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url).startsWith('https://evolution.invalid/message/search?')) return Response.json({ jsonapi: { version: '1.1' }, data: [retainedImage] });
    return new Response(Uint8Array.from(atob(png), byte => byte.charCodeAt(0)), { headers: { 'content-type': 'image/png' } });
  });
  const env = { DB: db as unknown as D1Database, TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', EVOLUTION_BASE_URL: 'https://evolution.invalid', IMAGE_STORAGE_ORIGINS: 'https://storage.example.test' } as Env;
  const handler = createMcpHandler(() => createMcpServer(env, { id: 'claim-user-a', email: 'a@example.test', claims: {} }), { legacy: 'reject', responseMode: 'json' });
  async function rpc<T = SelectionResult>(method: string, params: Record<string, unknown> = {}) {
    const response = await handler.fetch(new Request('https://mcp.invalid/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(method === 'tools/call' ? { 'Mcp-Name': String(params.name) } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: {
        [PROTOCOL_VERSION_META_KEY]: '2026-07-28', [CLIENT_INFO_META_KEY]: { name: 'selection-tests', version: '1.0.0' }, [CLIENT_CAPABILITIES_META_KEY]: {},
      } } }),
    }));
    return response.json() as Promise<{ result: T }>;
  }
  return { fetcher, auditBindings, rpc, changeDefault: () => { defaultConnection = workConnection; }, call: (args: Record<string, unknown> = {}) => rpc('tools/call', { name: 'get_gallery_image', arguments: { connectionId, messageId: 'image-1', conversationId, ...args } }) };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('selected image MCP boundary', () => {
  it('returns the selected image and matching original connection metadata privately', async () => {
    const { call, fetcher, auditBindings } = await selectionTool();
    const { result } = await call();
    expect(result.isError).not.toBe(true);
    expect(result._meta?.selection).toEqual({
      content: [{ type: 'image', data: png, mimeType: 'image/png' }],
      message: { connectionId, messageId: 'image-1', conversationId, to: conversationId, sender: '5511999999999@s.whatsapp.net', direction: 'inbound', timestamp: '2026-10-15T10:00:00.000Z', caption: 'Foto de teste', mimeType: 'image/png' },
    });
    expect(JSON.stringify({ content: result.content, structuredContent: result.structuredContent, auditBindings })).not.toMatch(/iVBOR|signature|private-signed-value|instance-secret|Foto de teste/);
    expect(Object.fromEntries(new URL(String(fetcher.mock.calls[0][0])).searchParams)).toEqual({ chat: conversationId, encodingFormat: 'image/*', limit: '50' });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('apikey')).toBe('instance-secret');
    expect(fetcher.mock.calls[1][1]).toMatchObject({ redirect: 'error', credentials: 'omit' });
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('apikey')).toBeNull();
  });

  it('selects an older image found by the gallery text filter outside the unfiltered recent window', async () => {
    const { call, rpc, fetcher } = await selectionTool();
    const filter = 'Foto antiga & família + viagem';
    const oldImage = { ...retainedImage, id: 'old-image' };
    fetcher.mockImplementation(async url => {
      const request = new URL(String(url));
      if (request.pathname === '/message/search') {
        const items = request.searchParams.get('q') === filter
          ? [oldImage]
          : Array.from({ length: 50 }, (_, index) => ({ ...retainedImage, id: `recent-${index}` }));
        return Response.json({ jsonapi: { version: '1.1' }, data: items });
      }
      return new Response(Uint8Array.from(atob(png), byte => byte.charCodeAt(0)), { headers: { 'content-type': 'image/png' } });
    });
    const gallery = await rpc<{ _meta: { gallery: { text: string; items: Array<{ id: string }> } } }>('tools/call', {
      name: 'show_image_gallery', arguments: { connectionId, conversationId, text: filter },
    });
    expect(gallery.result._meta.gallery.items.map(item => item.id)).toEqual(['old-image']);
    const { result } = await call({ messageId: 'old-image', text: gallery.result._meta.gallery.text });
    expect(result.isError).not.toBe(true);
    expect(result._meta?.selection).toMatchObject({
      content: [{ type: 'image', data: png, mimeType: 'image/png' }],
      message: { connectionId, conversationId, messageId: 'old-image' },
    });
    expect(Object.fromEntries(new URL(String(fetcher.mock.calls[1][0])).searchParams)).toEqual({ q: filter, chat: conversationId, encodingFormat: 'image/*', limit: '50' });
  });

  it('preserves the group destination and known participant for a quoted reply', async () => {
    const { call, fetcher } = await selectionTool();
    const groupId = '120363123456789@g.us';
    fetcher.mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data: [{ ...retainedImage, meta: { chat: groupId, fromMe: false } }] }));
    const { result } = await call({ conversationId: groupId });
    expect(result._meta?.selection?.message).toMatchObject({ connectionId, messageId: 'image-1', conversationId: groupId, to: groupId, sender: '5511999999999@s.whatsapp.net', participant: '5511999999999@s.whatsapp.net' });
  });

  it.each([
    ['text/html', Uint8Array.from(atob(png), byte => byte.charCodeAt(0))],
    ['image/jpeg', Uint8Array.from(atob(png), byte => byte.charCodeAt(0))],
    ['image/png', new TextEncoder().encode('<html>not an image</html>')],
    ['image/png', new Uint8Array()],
  ])('rejects storage content whose MIME or bytes do not match the retained image (%s)', async (mimeType, bytes) => {
    const { call, fetcher, auditBindings } = await selectionTool();
    fetcher.mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data: [retainedImage] }));
    fetcher.mockResolvedValueOnce(new Response(bytes, { headers: { 'content-type': mimeType } }));
    const { result } = await call();
    expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'selected_image_invalid', status: 415 } } } });
    expect(result._meta?.selection).toBeUndefined();
    expect(JSON.stringify({ result, auditBindings })).not.toMatch(/iVBOR|signature|private-signed-value|<html>|instance-secret/);
  });

  it('advertises the helper only for the app as a read-only operation', async () => {
    const { rpc, fetcher } = await selectionTool();
    const { result } = await rpc<{ tools: Array<{ name: string; _meta: { ui: { visibility: string[] } }; annotations: { readOnlyHint: boolean; idempotentHint: boolean }; inputSchema: { required: string[]; additionalProperties: boolean } }> }>('tools/list');
    expect(result.tools.find(tool => tool.name === 'get_gallery_image')).toMatchObject({
      _meta: { ui: { visibility: ['app'] } }, annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: { required: ['connectionId', 'conversationId', 'messageId'], additionalProperties: false },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { connectionId: undefined }, { connectionId: null }, { connectionId: 'instance-secret' },
    { conversationId: undefined }, { conversationId: '' }, { conversationId: 'x'.repeat(201) },
    { messageId: undefined }, { messageId: '' }, { messageId: 'x'.repeat(201) },
    { text: null }, { text: 123 }, { text: 'x'.repeat(201) },
    { url: 'https://storage.example.test/injected.png?signature=arbitrary-url' },
  ])('rejects missing identity and arbitrary client inputs before reading media %j', async (args) => {
    const { call, fetcher } = await selectionTool();
    expect((await call(args)).result.isError).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects another account before querying a coincident message ID', async () => {
    const { call, fetcher } = await selectionTool();
    const { result } = await call({ connectionId: otherConnectionId });
    expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'connection_not_found' } } } });
    expect(result._meta?.selection).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [],
    [{ ...retainedImage, id: 'other-message' }],
    [{ ...retainedImage, meta: { chat: 'other-conversation', fromMe: false } }],
  ])('does not fetch bytes for an absent message or mismatched provenance %j', async (...items) => {
    const { call, fetcher } = await selectionTool();
    fetcher.mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data: items }));
    const { result } = await call();
    expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'selected_image_unavailable' } } } });
    expect(result._meta?.selection).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined, 'https://attacker.example/image.png', 'https://storage.example.test.attacker.example/image.png',
    'http://storage.example.test/image.png', 'https://user:secret@storage.example.test/image.png',
    'https://storage.example.test/image.svg', 'data:image/png;base64,AAAA', 'https://evolution.invalid/image.png',
  ])('refuses unavailable or unapproved retained storage locations (%s)', async url => {
    const { call, fetcher } = await selectionTool();
    fetcher.mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data: [{ ...retainedImage, attributes: { ...retainedImage.attributes, body: { media: { url } } } }] }));
    const { result } = await call();
    expect(result.isError).toBe(true);
    expect(result._meta?.selection).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, '5242881'])('bounds the downloaded bytes even without a content length (%s)', async length => {
    const { call, fetcher } = await selectionTool();
    fetcher.mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data: [retainedImage] }));
    fetcher.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5242881)); controller.close(); } }), { headers: { 'content-type': 'image/png', ...(length ? { 'content-length': length } : {}) } }));
    const { result } = await call();
    expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'selected_image_too_large', status: 413 } } } });
    expect(result._meta?.selection).toBeUndefined();
  });

  it.each([403, 404, 302])('returns a recoverable safe result for expired or redirected storage (%s)', async status => {
    const { call, fetcher, auditBindings } = await selectionTool();
    fetcher.mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data: [retainedImage] }));
    fetcher.mockResolvedValueOnce(new Response('signature=private-token raw-envelope', { status, headers: { location: 'https://attacker.example/private' } }));
    const { result } = await call();
    expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'selected_image_unavailable' } } } });
    expect(result._meta?.selection).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify({ result, auditBindings })).not.toMatch(/signature|private-token|raw-envelope|attacker|instance-secret/);
  });

  it('sanitizes upstream authentication failures without proposing an automatic retry', async () => {
    const { call, fetcher, auditBindings } = await selectionTool();
    fetcher.mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, errors: [{ detail: 'https://storage.example.test/image.png?signature=private-link token=private-token raw-envelope' }] }, { status: 401 }));
    const { result } = await call();
    expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { status: 401, retryable: false } } } });
    expect(result._meta?.selection).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify({ result, auditBindings })).not.toMatch(/signature|private-link|private-token|raw-envelope|instance-secret/);
  });

  it('times out a stalled media stream without confirming or leaking image context', async () => {
    const { call, fetcher, auditBindings } = await selectionTool();
    let started: () => void = () => {};
    const reading = new Promise<void>(resolve => { started = resolve; });
    let canceled = false;
    fetcher.mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data: [retainedImage] }));
    fetcher.mockImplementationOnce(async () => { started(); return new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'content-type': 'image/png' } }); });
    vi.useFakeTimers();
    const pending = call();
    await reading;
    await vi.advanceTimersByTimeAsync(10_001);
    const { result } = await pending;
    expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'selected_image_timeout', status: 504, retryable: true } } } });
    expect(result._meta?.selection).toBeUndefined();
    expect(canceled).toBe(true);
    expect(JSON.stringify({ result, auditBindings })).not.toMatch(/signature|private-signed-value|instance-secret/);
  });

  // These independent 1x1 red fixtures were encoded and decoded with Pillow.
  it.each([
    ['image/jpeg', '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCLAGVxf//Z'],
    ['image/gif', 'R0lGODdhAQABAIEAAP8AAAAAAAAAAAAAACwAAAAAAQABAAAIBAABBAQAOw=='],
    ['image/webp', 'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA='],
    ['image/avif', 'AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAHgAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAQAAAAEAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAJm1kYXQSAAoFGAAGBCAyExQAAwwwxAAAeUzU33xM1O1T0oA='],
  ])('preserves actual visual bytes of supported %s media', async (mimeType, data) => {
    const { call, fetcher } = await selectionTool();
    fetcher.mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data: [{ ...retainedImage, attributes: { ...retainedImage.attributes, encodingFormat: mimeType } }] }));
    fetcher.mockResolvedValueOnce(new Response(Uint8Array.from(atob(data), byte => byte.charCodeAt(0)), { headers: { 'content-type': `${mimeType}; charset=binary` } }));
    expect((await call()).result._meta?.selection?.content).toEqual([{ type: 'image', data, mimeType }]);
  });

  it.each([conversationId, '120363123456789@g.us'])('reuses the selected message in an explicit reply after the default connection changes (%s)', async chat => {
    const { call, rpc, fetcher, changeDefault } = await selectionTool();
    fetcher.mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data: [{ ...retainedImage, meta: { chat, fromMe: false } }] }));
    const selection = (await call({ conversationId: chat })).result._meta!.selection!;
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes('/send/'))).toBe(true);
    changeDefault();
    fetcher.mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data: { type: 'message', id: 'reply-1', meta: { chat } } }));
    const { connectionId: selectedConnection, to, messageId, participant } = selection.message;
    const { result } = await rpc('tools/call', { name: 'reply_to_message', arguments: { connectionId: selectedConnection, to, messageId, ...(participant ? { participant } : {}), text: 'Resposta de teste' } });
    expect(result.isError).not.toBe(true);
    const sends = fetcher.mock.calls.filter(([url]) => String(url).includes('/send/'));
    expect(sends).toHaveLength(1);
    expect(String(sends[0][0])).toBe('https://evolution.invalid/send/text');
    expect(sends[0][1]?.method).toBe('POST');
    expect(new Headers(sends[0][1]?.headers).get('apikey')).toBe('instance-secret');
    expect(JSON.parse(String(sends[0][1]?.body))).toEqual({ data: {
      type: 'message', attributes: { encodingFormat: 'text/plain', body: { text: 'Resposta de teste' } },
      relationships: { recipient: { data: { type: 'chat', id: chat } }, quoted: { data: { type: 'message', id: 'image-1', ...(chat.endsWith('@g.us') ? { meta: { participant: '5511999999999@s.whatsapp.net' } } : {}) } } },
    } });
  });
});
