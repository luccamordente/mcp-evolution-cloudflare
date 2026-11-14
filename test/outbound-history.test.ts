import { migrateToolArguments, migrateToolCall } from './helpers/tool-arguments';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpHandler, PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { createMcpServer } from '../src/lib/mcp';
import { encryptToken } from '../src/lib/crypto';
import { EvolutionGoClient } from '../src/lib/evolution';
import type { ConnectionRecord, Env } from '../src/types';

const connectionId = 'f3ac5ad3-a16f-4be9-b178-33ceac13df2d';
const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const jsonapi = { version: '1.1' };

type Route = (url: URL, body: any) => Response | undefined;

async function harness(route: Route, scopes: string[] | null = ['mcp:read', 'mcp:write'], maxMediaBytes?: number) {
  const connection: ConnectionRecord = {
    id: connectionId, userId: 'db-user-a', friendlyName: 'heitor', instanceId: 'instance-a',
    encryptedToken: await encryptToken('instance-secret', encryptionKey), createdAt: '2026-10-27', updatedAt: '2026-10-27',
  };
  const outbound = new Map<string, unknown[]>();
  const audits: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (sql.startsWith('SELECT id, email FROM users')) return { id: 'db-user-a', email: values[0] };
              if (sql.includes('FROM whatsapp_connections WHERE id = ?1 AND user_id = ?2')) return values[0] === connection.id ? connection : null;
              return null;
            },
            async all() {
              return { results: sql.includes('is_default = 1') ? [connection] : [] };
            },
            async run() {
              if (sql.includes('INTO outbound_messages')) outbound.set(`${values[0]}|${values[1]}`, values);
              if (sql.includes('INTO audit_log')) audits.push(values);
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  const requests: Array<{ url: URL; body: any; headers: Headers }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, body, headers: new Headers(init?.headers) });
    return route(url, body) ?? Response.json({ jsonapi, data: [] });
  });
  const env = { DB: db as unknown as D1Database, TOKEN_ENCRYPTION_KEY: encryptionKey, EVOLUTION_BASE_URL: 'https://evolution.invalid', EVOLUTION_GLOBAL_API_KEY: 'g', ENVIRONMENT: 'local', MAX_MEDIA_BYTES: maxMediaBytes === undefined ? undefined : String(maxMediaBytes) } as Env;
  const handler = createMcpHandler(() => createMcpServer(env, { id: 'claim-user-a', email: 'a@example.test', claims: {} }), { legacy: 'reject', responseMode: 'json' });
  async function call(name: string, args: Record<string, unknown>, meta: Record<string, unknown> = {}) {
    const migrated = migrateToolCall({ name, arguments: args });
    name = String(migrated.name); args = migrated.arguments as Record<string, unknown>;
    if (name === 'send_message' && !args.options) args = migrateToolArguments(name, args);
    const response = await handler.fetch(new Request('https://mcp.invalid/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': name },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, _meta: {
        ...meta,
        [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
        [CLIENT_INFO_META_KEY]: { name: 'outbound-tests', version: '1.0.0' },
        [CLIENT_CAPABILITIES_META_KEY]: {},
      } } }),
    }), scopes === null ? undefined : { authInfo: { token: 't', clientId: 'c', scopes } });
    return (await response.json() as { result: { isError?: boolean; structuredContent: { data: any } } }).result;
  }
  return { call, requests, outbound, audits };
}

const sent = (id: string) => Response.json({ jsonapi, data: { type: 'message', id, meta: { chat: '551142000028' } } });

afterEach(() => vi.restoreAllMocks());

describe('outbound history', () => {
  it.each([null, ['mcp:read']])('denies HTTP writes with insufficient authorization (%j), including forged client permissions', async (scopes) => {
    const { call, requests } = await harness(() => sent('UNAUTHORIZED'), scopes);
    const forged = { trustedLocalScopes: ['mcp:read', 'mcp:write'], scopes: ['mcp:write'], http: { authInfo: { scopes: ['mcp:write'] } } };
    for (const tool of [
      { name: 'send_message', arguments: migrateToolArguments("send_message", { message: { kind: 'text', to: '551142000028', text: 'Must not send' } }) },
      { name: 'send_message', arguments: migrateToolArguments("send_message", { message: { kind: 'image', to: '551142000028', mimeType: 'image/png', source: { kind: 'base64', dataBase64: 'invalid base64' } } }) },
    ]) {
      const result = await call(tool.name, tool.arguments, forged);
      expect(result.isError).toBe(true);
      expect(result.structuredContent.data.error).toMatchObject({ code: 'insufficient_scope', status: 403 });
    }
    expect(requests).toHaveLength(0);
  });

  it('returns the send ID without making an unretained send available as history or forwarding content', async () => {
    const { call, requests } = await harness((url) => url.pathname.startsWith('/send/') ? sent('SENT1') : url.pathname === '/message/status' ? Response.json({ jsonapi, errors: [{ status: '404' }] }, { status: 404 }) : undefined);
    const send = await call('send_message', { message: { kind: 'text', to: '551142000028', text: 'qa wapilot send 1' } });
    expect(send.isError).toBeFalsy();
    expect(send.structuredContent.data.messageId).toBe('SENT1');
    const history = await call('list_messages', {});
    expect(history.structuredContent.data.items).toEqual([]);
    const forward = await call('send_message', { message: { kind: 'forward', to: '553175093234', source: { conversationId: '551142000028', messageId: 'SENT1' } } });
    expect(forward.isError).toBe(true);
    expect(forward.structuredContent.data.error.status).toBe(404);
    expect(requests.filter(r => r.url.pathname.startsWith('/send/'))).toHaveLength(1);
  });

  it('preserves IDs, quote arguments and media bodies without storing send content', async () => {
    let n = 0;
    const { call, requests } = await harness((url) => url.pathname.startsWith('/send/') ? sent(`S${++n}`) : undefined);
    const reply = await call('send_message', { message: { kind: 'text', to: '551142000028', text: 'qa reply', replyTo: { messageId: 'X', participant: '5511888888888' } } });
    const media = await call('send_message', { message: { kind: 'document', to: '551142000028', mimeType: 'application/pdf', fileName: 'qa-test.pdf', caption: 'doc', source: { kind: 'base64', dataBase64: btoa('%PDF-1.1') }, replyTo: { messageId: 'X' } } });
    expect(reply.structuredContent.data.messageId).toBe('S1');
    expect(media.structuredContent.data.messageId).toBe('S2');
    expect(requests[0].body).toMatchObject({ data: { attributes: { body: { text: 'qa reply' } } } });
    expect(requests[0].body.data.relationships.quoted.data).toEqual({ type: 'message', id: 'X', meta: { participant: '5511888888888' } });
    expect(requests[1].body).toMatchObject({ data: { attributes: { body: { media: { url: btoa('%PDF-1.1') } } } } });
    expect(requests[1].body.data.attributes.filename).toBe('qa-test.pdf');
    expect(requests[1].body.data.relationships.quoted.data).toEqual({ type: 'message', id: 'X' });
  });

  it.each([
    { encodingFormat: 'image/png', body: { text: 'cap', media: { encodingFormat: 'image/png' } } },
    { encodingFormat: 'application/octet-stream', body: { text: 'cap', media: { fileName: 'imagem.png' } } },
    { encodingFormat: 'application/octet-stream', filename: 'imagem.png', body: { text: 'cap' } },
    { encodingFormat: 'application/octet-stream', body: { text: 'cap', filename: 'imagem.png' } },
  ])('does not forward only the caption of an attachment without its file: %j', async attributes => {
    const { call, requests } = await harness(url => url.pathname === '/message/search' ? Response.json({ jsonapi, data: [{ type: 'message', id: 'S1', attributes, meta: { chat: '551142000028' } }] }) : undefined);
    const forward = await call('send_message', { message: { kind: 'forward', to: '553175093234', source: { conversationId: '551142000028', messageId: 'S1' } } });
    expect(forward.isError).toBe(true);
    expect(forward.structuredContent.data.error.status).toBe(422);
    expect(requests.filter(r => r.url.pathname.startsWith('/send/'))).toHaveLength(0);
  });

  it('forwards the retained attachment when singular metadata accompanies a media-array URL', async () => {
    const { call, requests } = await harness(url => {
      if (url.pathname === '/message/search') return Response.json({ jsonapi, data: [{
        type: 'message', id: 'S1', attributes: { encodingFormat: 'application/pdf', body: {
          media: { fileName: 'contrato.pdf' },
          medias: [{ encodingFormat: 'application/pdf', url: 'https://storage.example.test/retained.pdf' }],
        } }, meta: { chat: '551142000028' },
      }] });
      if (url.pathname === '/send/media') return sent('FWD1');
      return undefined;
    });
    const forward = await call('send_message', { message: { kind: 'forward', to: '553175093234', source: { conversationId: '551142000028', messageId: 'S1' } } });
    expect(forward.isError).toBeFalsy();
    expect(forward.structuredContent.data.messageId).toBe('FWD1');
    expect(requests.find(r => r.url.pathname === '/send/media')?.body.data.attributes).toMatchObject({
      encodingFormat: 'application/pdf', filename: 'contrato.pdf', body: { media: { url: 'https://storage.example.test/retained.pdf' } },
    });
  });

  it('falls back to Evolution Go /message/status when the source is not in history', async () => {
    const { call, requests } = await harness((url, body) => {
      if (url.pathname === '/message/status') {
        expect(body).toEqual({ data: { type: 'message', id: 'OLD1' } });
        return Response.json({ jsonapi, data: { type: 'message', id: 'OLD1', attributes: { at: 1, encodingFormat: 'text/plain', body: { text: 'antiga' } }, meta: { chat: '551142000028' } } });
      }
      if (url.pathname === '/send/text') return sent('FWD1');
      return undefined;
    });
    const forward = await call('send_message', { message: { kind: 'forward', to: '553175093234', source: { conversationId: '551142000028', messageId: 'OLD1' } } });
    expect(forward.isError).toBeFalsy();
    expect(forward.structuredContent.data.messageId).toBe('FWD1');
    expect(requests.map((r) => r.url.pathname)).toEqual(['/message/search', '/message/status', '/send/text']);
    expect(requests[2].body.data.attributes.body).toEqual({ text: 'antiga' });
  });

  it('returns explicit unavailability when the provider has no retained message', async () => {
    const { call } = await harness((url) => (url.pathname === '/message/status'
      ? Response.json({ jsonapi, errors: [{ status: '404', detail: 'message was not stored' }] }, { status: 404 })
      : undefined));
    const forward = await call('send_message', { message: { kind: 'forward', to: '553175093234', source: { conversationId: '551142000028', messageId: 'NOPE' } } });
    expect(forward.isError).toBe(true);
    expect(forward.structuredContent.data.error.status).toBe(404);
    expect(forward.structuredContent.data.error.message).toContain('WaPilot');
  });
});

describe('list_messages type mapping', () => {
  const client = (data: unknown[]) => new EvolutionGoClient({ baseUrl: 'https://e.invalid', instanceToken: 't', instanceId: 'i', fetcher: (async () => Response.json({ jsonapi, data })) as any });

  it('reports text rows as text/plain and flags rows without stored content', async () => {
    const page = await client([
      { type: 'message', id: 'A', attributes: { at: 1792598216000, encodingFormat: 'application/octet-stream', body: { text: 'oi' } }, meta: { chat: '551142000028' } },
      { type: 'message', id: 'B', attributes: { at: 1792598215000, encodingFormat: 'application/octet-stream' }, meta: { chat: '551142000028' } },
      { type: 'message', id: 'C', attributes: { at: 1792598214000, encodingFormat: 'application/pdf', body: { media: { url: 'https://s.invalid/a.pdf', encodingFormat: 'application/pdf' } } }, meta: { chat: '551142000028' } },
      { type: 'message', id: 'D', attributes: { at: 1792598213000, encodingFormat: 'text/plain', body: { text: 'olá' } } },
    ]).listMessages(undefined, 10, '551142000028');
    expect(page.items[0]).toMatchObject({ id: 'A', type: 'text/plain', text: 'oi' });
    expect(page.items[0].contentUnavailable).toBeUndefined();
    expect(page.items[1]).toMatchObject({ id: 'B', contentUnavailable: true, contentUnavailableReason: 'not_retained_or_unknown', messageType: 'application/octet-stream' });
    expect(page.items[1].type).toBeUndefined();
    expect(page.items[2]).toMatchObject({ id: 'C', type: 'application/pdf', media: { mimeType: 'application/pdf', url: 'https://s.invalid/a.pdf' } });
    expect(page.items[3]).toMatchObject({ id: 'D', type: 'text/plain', text: 'olá' });
  });

  it('getMessage returns undefined for a message Evolution Go did not store', async () => {
    const c = new EvolutionGoClient({ baseUrl: 'https://e.invalid', instanceToken: 't', instanceId: 'i', fetcher: (async () => Response.json({ jsonapi, errors: [{ status: '404' }] }, { status: 404 })) as any });
    await expect(c.getMessage('X')).resolves.toBeUndefined();
  });
});

describe('provider-only message history', () => {
  const rows = [60, 40, 20].map(sec => ({ type: 'message', id: `I${sec}`, attributes: { at: 1792598200000 + sec * 1000, encodingFormat: 'text/plain', body: { text: `in ${sec}` } }, meta: { chat: '551142000028', fromMe: sec === 40 }, relationships: { author: { data: { type: 'chat', id: '551142000028' } } } }));
  it('preserves provider filters, page cursors and sent-source normalization', async () => {
    const { call, requests } = await harness(url => {
      if (url.pathname !== '/message/search') return undefined;
      const before = Number(url.searchParams.get('before') ?? Infinity);
      const limit = Number(url.searchParams.get('limit'));
      return Response.json({ jsonapi, data: rows.filter(row => row.attributes.at < before).slice(0, limit) });
    });
    const first = await call('list_messages', { conversationId: '551142000028', text: 'in', limit: 2 });
    expect(first.structuredContent.data.items.map((m: any) => m.id)).toEqual(['I60', 'I40']);
    expect(first.structuredContent.data.items[1]).toMatchObject({ direction: 'outbound' });
    expect(first.structuredContent.data.items[1].source).toBeUndefined();
    expect(first.structuredContent.data.hasMore).toBe(true);
    const second = await call('list_messages', { conversationId: '551142000028', text: 'in', limit: 2, offset: 2 });
    expect(second.structuredContent.data.items.map((m: any) => m.id)).toEqual(['I20']);
    expect(second.structuredContent.data.hasMore).toBe(false);
    for (const { url } of requests) {
      expect(url.searchParams.get('identifier')).toBe('551142000028');
      expect(url.searchParams.get('q')).toBe('in');
      expect(Number(url.searchParams.get('limit'))).toBeLessThanOrEqual(50);
    }
    expect(requests[1].url.searchParams.get('before')).toBeNull();
  });
});

describe('GIF acceptance', () => {
  const gifBase64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAAKAAAALAAAAAABAAEAAAICRAEAIfkEAAoAAAAsAAAAAAEAAQAAAgJEAQA7';
  const acceptedGIF = (id = 'GIF1', fileSize: unknown = 2048) => Response.json({
    jsonapi, data: {
      type: 'message', id,
      attributes: { encodingFormat: 'video/mp4', body: { medias: [{ encodingFormat: 'video/mp4', ...(fileSize === null ? {} : { fileSize }), fileName: 'animation.mp4', url: 'https://storage.invalid/private.mp4', mediaKey: 'private-upload-key' }] } },
      meta: { chat: '551142000028', flags: 65, instanceToken: 'private-token' },
    },
  });

  it('sends GIF bytes with caption and quote, returning safe converted metadata without caching content', async () => {
    const { call, requests, outbound, audits } = await harness(() => acceptedGIF());
    const result = await call('send_message', { message: { kind: 'gif', to: '551142000028', mimeType: 'image/gif', fileName: 'animation.gif', caption: 'A looping animation', source: { kind: 'base64', dataBase64: gifBase64 }, replyTo: { messageId: 'QUOTED1' } } });
    expect(result.isError).toBeFalsy();
    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe('/send/media');
    expect(requests[0].headers.get('apikey')).toBe('instance-secret');
    expect(requests[0].headers.get('content-type')).toBe('application/vnd.api+json');
    expect(requests[0].body.data).toEqual({
      type: 'message', attributes: { encodingFormat: 'image/gif', filename: 'animation.gif', gifPlayback: true, body: { text: 'A looping animation', media: { url: gifBase64 } } },
      relationships: { recipient: { data: { type: 'chat', id: '551142000028' } }, quoted: { data: { type: 'message', id: 'QUOTED1' } } },
    });
    expect(result.structuredContent.data).toMatchObject({ accepted: true, messageId: 'GIF1', media: { mimeType: 'video/mp4', fileName: 'animation.mp4', size: 2048, gifPlayback: true } });
    expect(outbound.size).toBe(0);
    expect(JSON.stringify({ result, outbound: [...outbound.values()], audits })).not.toMatch(/private-token|private-upload-key|private\.mp4|instance-secret/);
    expect(JSON.stringify({ result, outbound: [...outbound.values()], audits })).not.toContain(gifBase64);
  });

  it('accepts an MP4 playback option and normalizes MIME case and parameters', async () => {
    const { call, requests } = await harness(() => acceptedGIF());
    const result = await call('send_message', { message: { kind: 'video', to: '551142000028', mimeType: ' VIDEO/MP4 ; codecs=avc1', gifPlayback: true, source: { kind: 'base64', dataBase64: btoa('mp4-fixture') } } });
    expect(result.isError).toBeFalsy();
    expect(requests[0].body.data.attributes).toMatchObject({ encodingFormat: 'video/mp4', gifPlayback: true });
  });

  it('looks up a newly sent GIF in retained history before forwarding it as a GIF', async () => {
    let sends = 0;
    const { call, requests, outbound } = await harness((url) => {
      if (url.pathname === '/message/status') return Response.json({ jsonapi, data: {
        type: 'message', id: 'GIF1', attributes: { encodingFormat: 'video/mp4', body: { text: 'Loop', medias: [{ encodingFormat: 'video/mp4', url: 'https://storage.invalid/retained.mp4', fileName: 'animation.mp4' }] } }, meta: { chat: '551142000028', flags: 65 },
      } });
      if (url.pathname === '/send/media') return acceptedGIF(++sends === 1 ? 'GIF1' : 'GIF2');
      return undefined;
    });
    await call('send_message', { message: { kind: 'gif', to: '551142000028', mimeType: 'image/gif', source: { kind: 'base64', dataBase64: gifBase64 } } });
    const forward = await call('send_message', { message: { kind: 'forward', to: '553175093234', source: { conversationId: '551142000028', messageId: 'GIF1' } } });
    expect(forward.isError).toBeFalsy();
    expect(requests.map((r) => r.url.pathname)).toEqual(['/send/media', '/message/search', '/message/status', '/send/media']);
    expect(requests[3].body.data.attributes).toEqual({ encodingFormat: 'video/mp4', filename: 'animation.mp4', forwardingScore: 1, gifPlayback: true, body: { text: 'Loop', media: { url: 'https://storage.invalid/retained.mp4' } } });
    expect(forward.structuredContent.data.media.gifPlayback).toBe(true);
    expect(outbound.size).toBe(0);
  });

  it('does not substitute the GIF input size when the converted response omits a size', async () => {
    const { call, outbound } = await harness(() => acceptedGIF('GIF1', null));
    const result = await call('send_message', { message: { kind: 'gif', to: '551142000028', mimeType: 'image/gif', source: { kind: 'base64', dataBase64: gifBase64 } } });
    const media = result.structuredContent.data.media;
    expect(media.mimeType).toBe('video/mp4');
    expect(media).not.toHaveProperty('size');
    expect(outbound.size).toBe(0);
  });

  it('does not invent conversion metadata when the backend only acknowledges the send', async () => {
    const { call, outbound } = await harness(() => sent('GIF1'));
    const result = await call('send_message', { message: { kind: 'gif', to: '551142000028', mimeType: 'image/gif', source: { kind: 'base64', dataBase64: gifBase64 } } });
    expect(result.structuredContent.data).not.toHaveProperty('media');
    expect(outbound.size).toBe(0);
  });

  it('rejects an incompatible playback option before any backend call', async () => {
    const { call, requests, outbound } = await harness(() => acceptedGIF());
    const result = await call('send_message', { message: { kind: 'image', to: '551142000028', mimeType: 'image/png', gifPlayback: true, source: { kind: 'base64', dataBase64: btoa('png') } } });
    expect(result.isError).toBe(true);
    expect(requests).toHaveLength(0);
    expect(outbound.size).toBe(0);
  });

  it.each([null, ['mcp:read']])('requires write authorization for GIF sending (%j)', async (scopes) => {
    const { call, requests } = await harness(() => acceptedGIF(), scopes);
    const result = await call('send_message', { message: { kind: 'gif', to: '551142000028', mimeType: 'image/gif', source: { kind: 'base64', dataBase64: gifBase64 } } });
    expect(result.structuredContent.data.error).toMatchObject({ code: 'insufficient_scope', status: 403 });
    expect(requests).toHaveLength(0);
  });

  it('rejects another user connection and oversized input before sending', async () => {
    const { call, requests } = await harness(() => acceptedGIF(), undefined, 16);
    const foreign = await call('send_message', { connectionId: '54b85615-b212-4d2b-91e5-c41dcbec66ef', message: { kind: 'gif', to: '551142000028', mimeType: 'image/gif', source: { kind: 'base64', dataBase64: btoa('GIF89a') } } });
    expect(foreign.structuredContent.data.error).toMatchObject({ code: 'connection_not_found' });
    const large = await call('send_message', { message: { kind: 'gif', to: '551142000028', mimeType: 'image/gif', source: { kind: 'base64', dataBase64: gifBase64 } } });
    expect(large.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it('does not retry a failed conversion or record a successful send', async () => {
    const { call, requests, outbound, audits } = await harness(() => Response.json({ jsonapi, errors: [{ status: '503', detail: 'WaPilot GIF conversion is unavailable; token=private-token' }] }, { status: 503 }));
    const result = await call('send_message', { message: { kind: 'gif', to: '551142000028', mimeType: 'image/gif', source: { kind: 'base64', dataBase64: gifBase64 } } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.data.error).toMatchObject({ status: 503 });
    expect(requests).toHaveLength(1);
    expect(outbound.size).toBe(0);
    expect(JSON.stringify({ result, audits })).not.toMatch(/private-token|instance-secret/);
    expect(JSON.stringify({ result, audits })).not.toContain(gifBase64);
  });
});
