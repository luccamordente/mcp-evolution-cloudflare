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
              if (sql.includes('FROM outbound_messages')) {
                const row = outbound.get(`${values[0]}|${values[1]}`);
                if (!row) return null;
                const [, messageId, conversationId, encodingFormat, text, mediaJson, sentAt] = row;
                return { messageId, conversationId, encodingFormat, text, mediaJson, sentAt };
              }
              return null;
            },
            async all() {
              if (sql.includes('FROM outbound_messages')) {
                const [cid, before, after, max] = values as [string, string, string, number];
                const rows = [...outbound.values()].filter((r) => r[0] === cid && String(r[6]) < before && String(r[6]) >= after)
                  .sort((x, y) => String(y[6]).localeCompare(String(x[6]))).slice(0, max)
                  .map(([, messageId, conversationId, encodingFormat, text, mediaJson, sentAt]) => ({ messageId, conversationId, encodingFormat, text, mediaJson, sentAt }));
                return { results: rows };
              }
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
    const { call, requests, outbound } = await harness(() => sent('UNAUTHORIZED'), scopes);
    const forged = { trustedLocalScopes: ['mcp:read', 'mcp:write'], scopes: ['mcp:write'], http: { authInfo: { scopes: ['mcp:write'] } } };
    for (const tool of [
      { name: 'send_text', arguments: { to: '551142000028', text: 'Must not send' } },
      { name: 'send_media', arguments: { to: '551142000028', mimeType: 'image/png', dataBase64: 'invalid base64' } },
    ]) {
      const result = await call(tool.name, { ...tool.arguments, ...forged }, forged);
      expect(result.isError).toBe(true);
      expect(result.structuredContent.data.error).toMatchObject({ code: 'insufficient_scope', status: 403 });
    }
    expect(requests).toHaveLength(0);
    expect(outbound.size).toBe(0);
  });

  it('records send_text and forwards it without needing Evolution Go history', async () => {
    let n = 0;
    const { call, requests, outbound } = await harness((url) => (url.pathname.startsWith('/send/') ? sent(`SENT${++n}`) : undefined));
    const send = await call('send_text', { to: '551142000028', text: 'qa wapilot send 1' });
    expect(send.isError).toBeFalsy();
    expect(send.structuredContent.data.messageId).toBe('SENT1');
    expect(outbound.get(`${connectionId}|SENT1`)?.slice(1, 5)).toEqual(['SENT1', '551142000028', 'text/plain', 'qa wapilot send 1']);

    const forward = await call('forward_message', { to: '553175093234', conversationId: '551142000028', messageId: 'SENT1' });
    expect(forward.isError).toBeFalsy();
    expect(forward.structuredContent.data.messageId).toBe('SENT2');
    expect(requests.some((r) => r.url.pathname === '/message/search')).toBe(false);
    const last = requests.at(-1)!;
    expect(last.url.pathname).toBe('/send/text');
    expect(last.body.data.attributes).toEqual({ encodingFormat: 'text/plain', body: { text: 'qa wapilot send 1' }, forwardingScore: 1 });
  });

  it('records reply_to_message and send_media metadata', async () => {
    let n = 0;
    const { call, outbound } = await harness((url) => (url.pathname.startsWith('/send/') ? sent(`S${++n}`) : undefined));
    await call('reply_to_message', { to: '551142000028', messageId: 'X', text: 'qa reply' });
    await call('send_media', { to: '551142000028', mimeType: 'application/pdf', fileName: 'qa-test.pdf', dataBase64: btoa('%PDF-1.1'), caption: 'doc' });
    expect(outbound.get(`${connectionId}|S1`)?.[4]).toBe('qa reply');
    const media = outbound.get(`${connectionId}|S2`)!;
    expect(media[3]).toBe('application/pdf');
    expect(JSON.parse(String(media[5]))).toEqual({ mimeType: 'application/pdf', fileName: 'qa-test.pdf', size: 8 });
  });

  it('does not forward only the caption of a media message whose file was not retained', async () => {
    let n = 0;
    const { call, requests } = await harness((url) => (url.pathname.startsWith('/send/') ? sent(`S${++n}`) : undefined));
    await call('send_media', { to: '551142000028', mimeType: 'image/png', dataBase64: btoa('png'), caption: 'cap' });
    const forward = await call('forward_message', { to: '553175093234', conversationId: '551142000028', messageId: 'S1' });
    expect(forward.isError).toBe(true);
    expect(forward.structuredContent.data.error.status).toBe(422);
    expect(requests.filter((r) => r.url.pathname.startsWith('/send/'))).toHaveLength(1);
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
    const forward = await call('forward_message', { to: '553175093234', conversationId: '551142000028', messageId: 'OLD1' });
    expect(forward.isError).toBeFalsy();
    expect(forward.structuredContent.data.messageId).toBe('FWD1');
    expect(requests.map((r) => r.url.pathname)).toEqual(['/message/search', '/message/status', '/send/text']);
    expect(requests[2].body.data.attributes.body).toEqual({ text: 'antiga' });
  });

  it('still returns 404 when neither wapilot nor Evolution Go has the message', async () => {
    const { call } = await harness((url) => (url.pathname === '/message/status'
      ? Response.json({ jsonapi, errors: [{ status: '404', detail: 'message was not stored' }] }, { status: 404 })
      : undefined));
    const forward = await call('forward_message', { to: '553175093234', conversationId: '551142000028', messageId: 'NOPE' });
    expect(forward.isError).toBe(true);
    expect(forward.structuredContent.data.error.status).toBe(404);
    expect(forward.structuredContent.data.error.message).toMatch(/Source message not found/);
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
    expect(page.items[1]).toMatchObject({ id: 'B', contentUnavailable: true });
    expect(page.items[1].type).toBeUndefined();
    expect(page.items[2]).toMatchObject({ id: 'C', type: 'application/pdf', media: { mimeType: 'application/pdf', url: 'https://s.invalid/a.pdf' } });
    expect(page.items[3]).toMatchObject({ id: 'D', type: 'text/plain', text: 'olá' });
  });

  it('getMessage returns undefined for a message Evolution Go did not store', async () => {
    const c = new EvolutionGoClient({ baseUrl: 'https://e.invalid', instanceToken: 't', instanceId: 'i', fetcher: (async () => Response.json({ jsonapi, errors: [{ status: '404' }] }, { status: 404 })) as any });
    await expect(c.getMessage('X')).resolves.toBeUndefined();
  });
});

describe('list_messages includes saved sends', () => {
  const t = (s: number) => 1792598200000 + s * 1000;
  const inbound = (id: string, sec: number, chat = '551142000028') => ({ type: 'message', id, attributes: { at: t(sec), encodingFormat: 'text/plain', body: { text: `in ${id}` } }, meta: { chat } });
  const save = (outbound: Map<string, unknown[]>, id: string, sec: number, chat = '551142000028', text = `out ${id}`) =>
    outbound.set(`${connectionId}|${id}`, [connectionId, id, chat, 'text/plain', text, null, new Date(t(sec)).toISOString()]);
  const search = (rows: any[]) => (url: URL) => {
    if (url.pathname !== '/message/search') return undefined;
    const before = url.searchParams.get('before');
    const limit = Number(url.searchParams.get('limit'));
    const q = url.searchParams.get('q')?.toLowerCase();
    return Response.json({ jsonapi, data: rows.filter((r) => (!before || r.attributes.at < Number(before)) && (!q || r.attributes.body.text.toLowerCase().includes(q))).slice(0, limit) });
  };

  it('merges sends newest-first with received history, filtered by conversation and text', async () => {
    const { call, outbound } = await harness(search([inbound('I3', 30), inbound('I1', 10)]));
    save(outbound, 'O2', 20); save(outbound, 'O4', 40); save(outbound, 'OX', 25, '553175093234');
    const all = await call('list_messages', { conversationId: '551142000028@s.whatsapp.net', cursor: '' });
    expect(all.isError).toBeFalsy();
    expect(all.structuredContent.data.items.map((m: any) => m.id)).toEqual(['O4', 'I3', 'O2', 'I1']);
    expect(all.structuredContent.data.items[0]).toMatchObject({ direction: 'outbound', text: 'out O4' });
    expect(all.structuredContent.data.hasMore).toBe(false);
    const filtered = await call('list_messages', { conversationId: '551142000028', text: 'OUT o2' });
    expect(filtered.structuredContent.data.items.map((m: any) => m.id)).toEqual(['O2']);
  });

  it('pages through merged history without duplicates or gaps', async () => {
    const rows = [inbound('I6', 60), inbound('I4', 40), inbound('I2', 20)];
    const { call, outbound } = await harness(search(rows));
    save(outbound, 'O5', 50); save(outbound, 'O3', 30); save(outbound, 'O1', 10);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await call('list_messages', { limit: 2, ...(cursor ? { cursor } : {}) });
      expect(page.isError).toBeFalsy();
      const data = page.structuredContent.data;
      expect(data.items.length).toBeLessThanOrEqual(2);
      seen.push(...data.items.map((m: any) => m.id));
      if (!data.hasMore) break;
      cursor = data.nextCursor;
    }
    expect(seen).toEqual(['I6', 'O5', 'I4', 'O3', 'I2', 'O1']);
  });

  it('does not duplicate a send that Evolution Go also stored', async () => {
    const { call, outbound } = await harness(search([inbound('SAME', 30)]));
    save(outbound, 'SAME', 30);
    const page = await call('list_messages', {});
    expect(page.structuredContent.data.items.map((m: any) => m.id)).toEqual(['SAME']);
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

  it('sends GIF bytes with caption and quote, and records safe converted metadata', async () => {
    const { call, requests, outbound, audits } = await harness(() => acceptedGIF());
    const result = await call('send_media', {
      to: '551142000028', mimeType: 'image/gif', fileName: 'animation.gif', dataBase64: gifBase64,
      caption: 'A looping animation', replyTo: 'QUOTED1',
    });
    expect(result.isError).toBeFalsy();
    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe('/send/media');
    expect(requests[0].headers.get('apikey')).toBe('instance-secret');
    expect(requests[0].headers.get('content-type')).toBe('application/vnd.api+json');
    expect(requests[0].body.data).toEqual({
      type: 'message', attributes: { encodingFormat: 'image/gif', filename: 'animation.gif', body: { text: 'A looping animation', media: { url: gifBase64 } } },
      relationships: { recipient: { data: { type: 'chat', id: '551142000028' } }, quoted: { data: { type: 'message', id: 'QUOTED1' } } },
    });
    expect(result.structuredContent.data).toMatchObject({ accepted: true, messageId: 'GIF1', media: { mimeType: 'video/mp4', fileName: 'animation.mp4', size: 2048, gifPlayback: true } });
    const row = outbound.get(`${connectionId}|GIF1`)!;
    expect(row[3]).toBe('video/mp4');
    expect(JSON.parse(String(row[5]))).toEqual({ mimeType: 'video/mp4', fileName: 'animation.mp4', size: 2048, gifPlayback: true });
    expect(JSON.stringify({ result, outbound: [...outbound.values()], audits })).not.toMatch(/private-token|private-upload-key|private\.mp4|instance-secret/);
    expect(JSON.stringify({ result, outbound: [...outbound.values()], audits })).not.toContain(gifBase64);
  });

  it('accepts an MP4 playback option and normalizes MIME case and parameters', async () => {
    const { call, requests } = await harness(() => acceptedGIF());
    const result = await call('send_media', { to: '551142000028', mimeType: ' VIDEO/MP4 ; codecs=avc1', gifPlayback: true, dataBase64: btoa('mp4-fixture') });
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
    await call('send_media', { to: '551142000028', mimeType: 'image/gif', dataBase64: gifBase64 });
    const forward = await call('forward_message', { to: '553175093234', conversationId: '551142000028', messageId: 'GIF1' });
    expect(forward.isError).toBeFalsy();
    expect(requests.map((r) => r.url.pathname)).toEqual(['/send/media', '/message/status', '/send/media']);
    expect(requests[2].body.data.attributes).toEqual({ encodingFormat: 'video/mp4', filename: 'animation.mp4', forwardingScore: 1, gifPlayback: true, body: { text: 'Loop', media: { url: 'https://storage.invalid/retained.mp4' } } });
    expect(JSON.parse(String(outbound.get(`${connectionId}|GIF2`)?.[5])).gifPlayback).toBe(true);
  });

  it('does not substitute the GIF input size when the converted response omits a size', async () => {
    const { call, outbound } = await harness(() => acceptedGIF('GIF1', null));
    await call('send_media', { to: '551142000028', mimeType: 'image/gif', dataBase64: gifBase64 });
    const media = JSON.parse(String(outbound.get(`${connectionId}|GIF1`)?.[5]));
    expect(media.mimeType).toBe('video/mp4');
    expect(media).not.toHaveProperty('size');
  });

  it('does not invent conversion metadata when the backend only acknowledges the send', async () => {
    const { call, outbound } = await harness(() => sent('GIF1'));
    const result = await call('send_media', { to: '551142000028', mimeType: 'image/gif', dataBase64: gifBase64 });
    expect(result.structuredContent.data).not.toHaveProperty('media');
    expect(outbound.get(`${connectionId}|GIF1`)?.[3]).toBe('image/gif');
  });

  it('rejects an incompatible playback option before any backend call', async () => {
    const { call, requests, outbound } = await harness(() => acceptedGIF());
    const result = await call('send_media', { to: '551142000028', mimeType: 'image/png', gifPlayback: true, dataBase64: btoa('png') });
    expect(result.isError).toBe(true);
    expect(requests).toHaveLength(0);
    expect(outbound.size).toBe(0);
  });

  it.each([null, ['mcp:read']])('requires write authorization for GIF sending (%j)', async (scopes) => {
    const { call, requests } = await harness(() => acceptedGIF(), scopes);
    const result = await call('send_media', { to: '551142000028', mimeType: 'image/gif', dataBase64: gifBase64 });
    expect(result.structuredContent.data.error).toMatchObject({ code: 'insufficient_scope', status: 403 });
    expect(requests).toHaveLength(0);
  });

  it('rejects another user connection and oversized input before sending', async () => {
    const { call, requests } = await harness(() => acceptedGIF(), undefined, 16);
    const foreign = await call('send_media', { connectionId: '54b85615-b212-4d2b-91e5-c41dcbec66ef', to: '551142000028', mimeType: 'image/gif', dataBase64: btoa('GIF89a') });
    expect(foreign.structuredContent.data.error).toMatchObject({ code: 'connection_not_found' });
    const large = await call('send_media', { to: '551142000028', mimeType: 'image/gif', dataBase64: gifBase64 });
    expect(large.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it('does not retry a failed conversion or record a successful send', async () => {
    const { call, requests, outbound, audits } = await harness(() => Response.json({ jsonapi, errors: [{ status: '503', detail: 'WaPilot GIF conversion is unavailable; token=private-token' }] }, { status: 503 }));
    const result = await call('send_media', { to: '551142000028', mimeType: 'image/gif', dataBase64: gifBase64 });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.data.error).toMatchObject({ status: 503 });
    expect(requests).toHaveLength(1);
    expect(outbound.size).toBe(0);
    expect(JSON.stringify({ result, audits })).not.toMatch(/private-token|instance-secret/);
    expect(JSON.stringify({ result, audits })).not.toContain(gifBase64);
  });
});
