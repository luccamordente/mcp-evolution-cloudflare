import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { z } from 'zod';
import { createMcpHandler, PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { createMcpServer } from '../src/lib/mcp';
import { createConnection, bootstrapLocalUser } from '../src/lib/db';
import { createTestD1 } from './helpers/local-d1';
import { sendMessageInput, expandSendMessage } from '../src/lib/send-message';
import type { Env } from '../src/types';
import app from '../src/index';
import { toolErrorScenarios } from './helpers/tool-error-scenarios';

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
it('publishes exactly six tools and no gallery resource', async () => {
  expect((await rpc('tools/list')).tools?.map(t => t.name)).toEqual(['search_connections', 'search_contacts', 'search_groups', 'search_messages', 'get_message', 'send_message']);
  const resources = await rpc('resources/list');
  expect(resources.resources).toEqual([expect.objectContaining({ uri: 'ui://wapilot/send-receipt-v3.html' })]);
});

for (const [code, scenario] of Object.entries(toolErrorScenarios)) {
  if (scenario.kind !== 'mcp') continue;
  it(`returns ${code} through the MCP boundary with recovery and safe identity`, async () => {
    let options: Record<string, unknown> = {};
    if (code === 'message_not_found') fetcher.mockResolvedValue(Response.json({ jsonapi: { version: '1.1' }, data: null }));
    else if (code === 'message_content_unavailable') resource = { type: 'message', id: 'm1', attributes: { encodingFormat: 'application/octet-stream', body: {} } };
    else if (code === 'message_content_pending') { resource = { type: 'message', id: 'm1', attributes: {}, meta: { observation: { version: 1, state: 'receipt_only', observedAt: 1794790925000, timestampSource: 'receipt' } } }; options = { encodingFormat: 'image/*' }; }
    else if (code === 'message_unavailable') fetcher.mockResolvedValue(new Response('private-response', { status: 503 }));
    else { resource = { type: 'message', id: 'm1', attributes: { body: { event: { name: 'Synthetic event' } } } }; options = { include: ['event-responses'] }; }
    const result = await call('get_message', { messageId: 'm1', options });
    expect(result).toMatchObject({ isError: true, structuredContent: { data: { connectionId, messageId: 'm1', error: {
      code, status: scenario.status, retryable: scenario.retryable, recovery: { action: scenario.action },
    } } } });
    const payload = z.object({ error: z.object({ recovery: z.object({ tool: z.string().optional(), steps: z.array(z.string()).min(1) }) }) }).parse(result.structuredContent?.data);
    expect(payload.error.recovery.tool).toBe(scenario.tool);
    const content = z.tuple([z.object({ type: z.literal('text'), text: z.string() })]).parse(result.content);
    expect(JSON.parse(content[0].text)).toEqual(result.structuredContent);
    expect(JSON.stringify(result)).not.toContain('private-response');
  });
}
it('advertises agent guidance, message variants and option descriptions', async () => {
  const result = await rpc('tools/list');
  const tools = z.array(z.object({ name: z.string(), title: z.string().min(1), description: z.string().min(30), inputSchema: z.record(z.string(), z.unknown()), outputSchema: z.record(z.string(), z.unknown()) })).parse(result.tools);
  const send = tools.find(tool => tool.name === 'send_message');
  const get = tools.find(tool => tool.name === 'get_message');
  const schema = z.object({ properties: z.object({ message: z.object({ anyOf: z.array(z.object({ description: z.string().min(10), properties: z.object({ kind: z.object({ const: z.string() }) }) })) }), options: z.object({ properties: z.object({ idempotencyKey: z.object({ description: z.string() }) }) }) }) }).parse(send?.inputSchema);
  const kinds = schema.properties.message.anyOf.map(variant => variant.properties.kind.const);
  expect(kinds).toHaveLength(16);
  for (const kind of kinds) expect(send?.description).toContain(kind);
  expect(schema.properties.options.properties.idempotencyKey.description).toContain('24 hours');
  const getSchema = z.object({ properties: z.object({ messageId: z.object({ description: z.string() }), options: z.object({ properties: z.object({ encodingFormat: z.object({ description: z.string() }), include: z.object({ description: z.string() }), limit: z.object({ description: z.string() }) }) }) }) }).parse(get?.inputSchema);
  expect(getSchema.properties.options.properties.include.description).toContain('transcript');
  expect(getSchema.properties.options.properties.include.description).toContain('15 minutes');
  expect(getSchema.properties.options.properties.encodingFormat.description).toContain('application/json');
  expect(getSchema.properties.options.properties.limit.description).toContain('1..5');
  expect(JSON.stringify(get?.outputSchema)).toContain('receipt_only');
  expect(JSON.stringify(get?.outputSchema)).toContain('observedAt');
  expect(JSON.stringify(tools.find(tool => tool.name === 'search_messages')?.inputSchema)).toContain('includeReceiptOnly');
  expect(JSON.stringify(await rpc('server/discover'))).toContain('data.error.recovery');
});

it('returns the latest retained delivery status without downloading media', async () => {
  expect(await call('get_message', { messageId: 'm1' })).toMatchObject({ structuredContent: { data: { connectionId, message: { status: 'Read', text: 'hello' } } } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

function retainAttachments() {
  env.MCP_PUBLIC_URL = 'https://app.example.test';
  env.DOCUMENT_STORAGE_ORIGINS = 'https://storage.example.test';
  resource = { type: 'message', id: 'm1', attributes: { encodingFormat: 'video/mp4', body: { text: 'caption', medias: [
    { encodingFormat: 'video/mp4', fileName: 'clip.mp4', fileSize: 4, duration: 12, width: 640, height: 480, url: 'https://storage.example.test/video?private=secret' },
    { encodingFormat: 'application/zip', fileName: 'archive.zip', fileSize: 3, url: 'https://storage.example.test/archive' },
  ] } } };
  fetcher.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'storage.example.test') {
      expect(new Headers(init?.headers).has('apikey')).toBe(false);
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      expect(init?.redirect).toBe('manual');
      return new Response(url.pathname === '/archive' ? 'zip' : 'clip');
    }
    return Response.json({ jsonapi: { version: '1.1' }, data: url.pathname === '/message/search' ? [resource] : resource });
  });
}
const attachmentsResult = z.object({ attachments: z.array(z.looseObject({ index: z.number(), downloadUrl: z.string(), expiresAt: z.string() })) });

it('returns JSON attachment metadata and sealed temporary links in get and search without downloading', async () => {
  retainAttachments();
  for (const [name, args] of [
    ['get_message', { messageId: 'm1', options: { encodingFormat: 'application/json', include: ['attachments'] } }],
    ['search_messages', { options: { encodingFormat: 'application/json', include: ['attachments'] } }],
  ] as const) {
    const result = await call(name, args);
    const data = name === 'get_message' ? result.structuredContent?.data : z.object({ items: z.array(z.unknown()) }).parse(result.structuredContent?.data).items[0];
    const parsed = attachmentsResult.parse(data);
    expect(parsed.attachments).toHaveLength(2);
    expect(parsed.attachments[0]).toMatchObject({ mimeType: 'video/mp4', fileName: 'clip.mp4', duration: 12, width: 640, height: 480 });
    expect(parsed.attachments[0].downloadUrl).toMatch(/^https:\/\/app.example.test\/attachments\//);
    expect(JSON.stringify(result)).not.toMatch(/storage.example.test|private=secret|synthetic-token/);
  }
  expect(fetcher.mock.calls).toHaveLength(2);
});

it('downloads the selected original through the signed link and rejects tampered or expired links', async () => {
  retainAttachments();
  const result = await call('get_message', { messageId: 'm1', options: { include: ['attachments'] } });
  const links = attachmentsResult.parse(result.structuredContent?.data).attachments;
  const response = await app.request(links[1].downloadUrl, {}, env);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('zip');
  expect(response.headers.get('content-type')).toBe('application/zip');
  expect(response.headers.get('content-disposition')).toContain('archive.zip');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const tampered = await app.request(links[1].downloadUrl + 'x', {}, env);
  expect(tampered.status).toBe(401);
  expect(await tampered.json()).toMatchObject({ error: { code: 'attachment_link_invalid', retryable: false, recovery: { action: 'inspect_message', tool: 'get_message' } } });
  vi.spyOn(Date, 'now').mockReturnValue(new Date(links[1].expiresAt).getTime());
  const expired = await app.request(links[1].downloadUrl, {}, env);
  expect(expired.status).toBe(401);
  expect(await expired.json()).toMatchObject({ error: { code: 'attachment_link_expired', retryable: false, recovery: { action: 'inspect_message', tool: 'get_message' } } });
});

it('rechecks connection ownership when a signed link is used', async () => {
  retainAttachments();
  const result = await call('get_message', { messageId: 'm1', options: { include: ['attachments'] } });
  const link = attachmentsResult.parse(result.structuredContent?.data).attachments[0].downloadUrl;
  await local.db.prepare('DELETE FROM whatsapp_connections WHERE id = ?').bind(connectionId).run();
  const response = await app.request(link, {}, env);
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: { code: 'attachment_not_found', retryable: false, recovery: { action: 'inspect_message', tool: 'get_message' } } });
  expect(fetcher.mock.calls).toHaveLength(1);
});

it.each([
  [401, 'contact_operator', false], [403, 'contact_operator', false],
  [404, 'inspect_message', false], [410, 'inspect_message', false],
  [429, 'retry_read', true], [503, 'retry_read', true],
])('returns safe download diagnostics for storage HTTP %s', async (status, action, retryable) => {
  retainAttachments();
  const result = await call('get_message', { messageId: 'm1', options: { include: ['attachments'] } });
  const link = attachmentsResult.parse(result.structuredContent?.data).attachments[0].downloadUrl;
  fetcher.mockImplementation(async input => new URL(String(input)).hostname === 'storage.example.test'
    ? new Response('private-response', { status: Number(status) })
    : Response.json({ jsonapi: { version: '1.1' }, data: resource }));
  const response = await app.request(link, {}, env);
  expect(response.status).toBe(status === 503 ? 502 : status);
  const body = await response.json();
  expect(body).toMatchObject({ error: { code: 'attachment_download_failed', retryable, recovery: { action } } });
  expect(JSON.stringify(body)).not.toMatch(/private-response|storage.example.test|synthetic-token/);
});

it('refuses previously issued attachment links after the account is disabled', async () => {
  retainAttachments();
  const result = await call('get_message', { messageId: 'm1', options: { include: ['attachments'] } });
  const link = attachmentsResult.parse(result.structuredContent?.data).attachments[0].downloadUrl;
  await local.db.prepare("UPDATE users SET status = 'disabled' WHERE email = ?1").bind(user.email).run();
  fetcher.mockClear();
  const response = await app.request(link, {}, env);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: 'attachment_not_found' } });
  expect(fetcher).not.toHaveBeenCalled();
});

it('reports the reason for a missing file source without losing the message', async () => {
  retainAttachments();
  resource = { type: 'message', id: 'm1', attributes: { encodingFormat: 'video/mp4', body: { text: 'caption', media: { fileName: 'missing.mp4', encodingFormat: 'video/mp4' } } } };
  expect(await call('get_message', { messageId: 'm1', options: { include: ['attachments'] } })).toMatchObject({ isError: true, structuredContent: { data: {
    partial: true, message: { text: 'caption' }, attachments: [{ downloadAvailable: false, error: { code: 'attachment_source_unavailable', recovery: { action: 'inspect_message' } } }],
  } } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('reports invalid download configuration before contacting storage', async () => {
  retainAttachments();
  const result = await call('get_message', { messageId: 'm1', options: { include: ['attachments'] } });
  const link = attachmentsResult.parse(result.structuredContent?.data).attachments[0].downloadUrl;
  env.MAX_MEDIA_BYTES = 'invalid';
  const response = await app.request(link, {}, env);
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ error: { code: 'attachment_configuration_error', retryable: false, recovery: { action: 'contact_operator' } } });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('returns an original binary resource for an exact MIME or octet-stream, without transcription', async () => {
  retainAttachments();
  for (const encodingFormat of ['application/zip', 'application/octet-stream']) {
    const result = await call('get_message', { messageId: 'm1', options: { encodingFormat, attachmentIndex: 1 } });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'resource', resource: expect.objectContaining({ mimeType: 'application/zip', blob: Buffer.from('zip').toString('base64') }) })]));
  }
  expect(await call('get_message', { messageId: 'm1', options: { encodingFormat: 'audio/ogg' } })).toMatchObject({ isError: true });
});

it.each(['transcript', 'document-text'])('rejects incompatible %s processing', async include => {
  expect(await call('get_message', { messageId: 'm1', options: { encodingFormat: 'application/json', include: [include] } })).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'incompatible_include' } } } });
});

it('uses text/plain only for an original text attachment, not audio transcription', async () => {
  retainAttachments();
  resource = { type: 'message', id: 'm1', attributes: { encodingFormat: 'audio/ogg', body: { media: { url: 'https://storage.example.test/audio' } } } };
  expect(await call('get_message', { messageId: 'm1', options: { encodingFormat: 'text/plain' } })).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'incompatible_encoding_format' } } } });
  resource = { type: 'message', id: 'm1', attributes: { encodingFormat: 'text/plain', body: { media: { url: 'https://storage.example.test/text', fileName: 'note.txt' } } } };
  expect(await call('get_message', { messageId: 'm1', options: { encodingFormat: 'text/plain' } })).toMatchObject({ structuredContent: { data: { mimeType: 'text/plain' } } });
});

it('marks unavailable downloads explicitly and preserves JSON metadata', async () => {
  retainAttachments();
  env.MCP_PUBLIC_URL = 'invalid';
  const result = await call('get_message', { messageId: 'm1', options: { include: ['attachments'] } });
  expect(result).toMatchObject({ isError: true, structuredContent: { data: { partial: true, attachments: [{ mimeType: 'video/mp4', downloadAvailable: false }, { mimeType: 'application/zip', downloadAvailable: false }], errors: expect.arrayContaining([expect.objectContaining({ part: 'attachments.0.download' })]) } } });
  expect(JSON.stringify(result)).not.toMatch(/downloadUrl|private=secret/);
});

it.each([{ attachmentIndex: -1, encodingFormat: 'application/octet-stream' }, { attachmentIndex: 0 }, { include: ['transcript'] }])('rejects invalid selection or processing on an operational lookup: %j', async options => {
  expect(await call('get_message', { options: { idempotencyKey: 'action', ...options } })).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'invalid_options' } } } });
  expect(fetcher).not.toHaveBeenCalled();
});

it('enforces size limits, storage allowlists and redirect rejection on signed downloads', async () => {
  retainAttachments();
  const result = await call('get_message', { messageId: 'm1', options: { include: ['attachments'] } });
  const link = attachmentsResult.parse(result.structuredContent?.data).attachments[0].downloadUrl;
  env.MAX_MEDIA_BYTES = '2';
  expect((await app.request(link, {}, env)).status).toBe(413);
  env.MAX_MEDIA_BYTES = '100';
  fetcher.mockImplementation(async input => new URL(String(input)).hostname === 'storage.example.test'
    ? new Response(null, { status: 302, headers: { location: 'https://evil.invalid' } })
    : Response.json({ data: resource }));
  expect((await app.request(link, {}, env)).status).toBe(502);
  const calls = fetcher.mock.calls.length;
  env.DOCUMENT_STORAGE_ORIGINS = '';
  expect((await app.request(link, {}, env)).status).toBe(502);
  expect(fetcher.mock.calls.length).toBe(calls + 1);
});

it('identifies invalid option paths and suggests a bounded correction', async () => {
  expect(await call('search_messages', { options: { limit: 51 } })).toMatchObject({ isError: true, structuredContent: { data: { error: {
    code: 'invalid_options', retryable: false, validationIssues: [{ path: 'options.limit' }],
    recovery: { action: 'correct_arguments', steps: expect.arrayContaining([expect.stringContaining('offset + limit <= 200')]) },
  } } } });
  expect(fetcher).not.toHaveBeenCalled();
});

it('delivers actionable errors as both structured MCP output and JSON text', async () => {
  const result = await call('search_messages', { options: { limit: 51 } });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({ data: { error: { code: 'invalid_options', recovery: { action: 'correct_arguments' } } } });
  const content = z.array(z.object({ type: z.literal('text'), text: z.string() })).parse(result.content);
  expect(JSON.parse(content[0]!.text)).toEqual(result.structuredContent);
});

it('retains message metadata and downloadable audio when transcription is unavailable', async () => {
  retainAttachments();
  env.AUDIO_STORAGE_ORIGINS = 'https://storage.example.test';
  resource = { type: 'message', id: 'm1', attributes: { encodingFormat: 'audio/ogg', body: { text: 'caption', media: { url: 'https://storage.example.test/audio', fileName: 'voice.ogg' } } } };
  expect(await call('get_message', { messageId: 'm1', options: { include: ['transcript', 'attachments'] } })).toMatchObject({ isError: true, structuredContent: { data: {
    partial: true, message: { id: 'm1', text: 'caption' }, attachments: [{ mimeType: 'audio/ogg', downloadAvailable: true }],
    error: { code: 'transcription_unavailable', recovery: { action: 'inspect_message', tool: 'get_message' } },
    errors: [{ part: 'transcript', error: { code: 'transcription_unavailable' } }],
  } } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('preserves search results when one attachment source cannot be exposed', async () => {
  retainAttachments();
  fetcher.mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data: [
    { type: 'message', id: 'bad-file', attributes: { encodingFormat: 'video/mp4', body: { media: { url: 'https://unapproved.invalid/file' } } } },
    { type: 'message', id: 'text-only', attributes: { body: { text: 'Available text' } } },
  ] }));
  expect(await call('search_messages', { options: { include: ['attachments'] } })).toMatchObject({ isError: true, structuredContent: { data: {
    partial: true, items: [{ id: 'bad-file', attachments: [{ downloadAvailable: false }] }, { id: 'text-only', text: 'Available text', attachments: [] }],
    errors: [{ part: 'items.0.attachments.0.download', error: { code: 'media_origin_not_allowed', recovery: { action: 'contact_operator' } } }],
  } } });
});

it('reports independent include failures while preserving the original binary', async () => {
  retainAttachments();
  const result = await call('get_message', { messageId: 'm1', options: { include: ['transcript', 'document-text', 'attachments'], encodingFormat: 'video/mp4' } });
  expect(result).toMatchObject({ isError: true, structuredContent: { data: { partial: true, attachments: expect.arrayContaining([expect.objectContaining({ downloadAvailable: true })]), errors: [
    { part: 'transcript', error: { code: 'incompatible_include' } }, { part: 'document-text', error: { code: 'incompatible_include' } },
  ] } } });
  expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'resource', resource: expect.objectContaining({ mimeType: 'video/mp4', blob: Buffer.from('clip').toString('base64') }) })]));
});

it('does not interpret unavailable event responses as zero RSVPs', async () => {
  resource = { type: 'message', id: 'm1', attributes: { body: { event: { name: 'Synthetic meeting' } } } };
  expect(await call('get_message', { messageId: 'm1', options: { include: ['event-responses'] } })).toMatchObject({ isError: true, structuredContent: { data: {
    partial: true, message: { event: { name: 'Synthetic meeting' } }, errors: [{ part: 'event-responses', error: { code: 'responses_unavailable', retryable: false, recovery: { action: 'inspect_message', tool: 'get_message' } } }],
  } } });
});

it('preserves connection records when optional live status fails', async () => {
  fetcher.mockResolvedValue(new Response('private-provider-body', { status: 401 }));
  expect(await call('search_connections', { options: { include: ['status'] } })).toMatchObject({ isError: true, structuredContent: { data: {
    partial: true, items: [{ id: connectionId, statusUnavailable: true }], errors: [{ part: 'status', connectionId, error: { status: 401, recovery: { action: 'select_connection' } } }],
  } } });
});

it('recovers a missing default connection through an explicit selection', async () => {
  await local.db.prepare('UPDATE whatsapp_connections SET is_default = 0').run();
  expect(await call('search_contacts', { query: 'Ana' })).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'no_default_connection', recovery: { action: 'select_connection', tool: 'search_connections' } } } } });
  expect(fetcher).not.toHaveBeenCalled();
});

it('limits retry guidance for a transient read and redacts URLs and bearer credentials', async () => {
  fetcher.mockResolvedValue(Response.json({ message: 'WaPilot temporary failure https://private.invalid/file Bearer abc123' }, { status: 429 }));
  const result = await call('search_groups');
  expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { status: 429, retryable: true, recovery: { action: 'retry_read', retryAfterMs: 5000 } } } } });
  expect(JSON.stringify(result)).not.toMatch(/private.invalid|abc123/);
});

it('reports public media field paths before a malformed send can dispatch', async () => {
  const result = await call('send_message', { message: { kind: 'image' }, options: { to: '5511999999999' } });
  expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'invalid_options', retryable: false,
    validationIssues: expect.arrayContaining([expect.objectContaining({ path: 'options.mediaSource' })]), recovery: { action: 'correct_arguments' },
  } } } });
  expect(fetcher).not.toHaveBeenCalled();
});

it('explains incompatible Status kinds before dispatch', async () => {
  expect(await call('send_message', { message: { kind: 'location', name: 'Synthetic location', address: 'Synthetic address', latitude: 1, longitude: 1 }, options: { to: 'status' } })).toMatchObject({ isError: true, structuredContent: { data: {
    dispatchState: 'not_started', error: { code: 'invalid_options', message: expect.stringContaining('Status supports text, image and video only'), recovery: { action: 'correct_arguments' } },
  } } });
  expect(fetcher).not.toHaveBeenCalled();
});

it('reconciles an uncertain send without retrying it or exposing the service response', async () => {
  fetcher.mockResolvedValue(new Response('private-provider-body https://private.invalid/secret', { status: 503 }));
  const result = await call('send_message', { message: { kind: 'text', text: 'Synthetic message' }, options: { to: '5511999999999', idempotencyKey: 'error-reconciliation' } });
  expect(result).toMatchObject({ isError: true, structuredContent: { data: { outcome: 'unknown', dispatchState: 'unconfirmed', error: { status: 503, retryable: false, recovery: { action: 'reconcile_send', tool: 'get_message' } } } } });
  expect(JSON.stringify(result)).not.toMatch(/private-provider|private.invalid/);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await call('get_message', { options: { idempotencyKey: 'error-reconciliation' } })).toMatchObject({ structuredContent: { data: { outcome: 'unknown', hint: expect.stringContaining('repeat this status lookup once') } } });
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
  expect(await call('get_message', { messageId: 'm1', options: { encodingFormat } })).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'incompatible_encoding_format', recovery: { action: 'correct_arguments' } } } } });
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
  await local.db.prepare('UPDATE whatsapp_connections SET encrypted_token = ? WHERE id = ?').bind('not-ciphertext', connectionId).run();
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

it('keeps complete message text when its provider MIME is malformed', async () => {
  resource = { type: 'message', id: 'm1', attributes: { encodingFormat: 'private-mime https://private.invalid/file?token=secret-value', body: { text: 'hello' } } };
  const result = await call('get_message', { messageId: 'm1' });
  expect(result.isError).not.toBe(true);
  expect(result).toMatchObject({ structuredContent: { data: { message: { id: 'm1', text: 'hello' } } } });
  expect(JSON.stringify(result)).not.toMatch(/private-mime|private\.invalid|secret-value/);
});

it('disables invocation URL logs while retaining sanitized application logs', () => {
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  expect(config.observability).toMatchObject({ enabled: true, redact_query_string: true, logs: { enabled: true, invocation_logs: false }, traces: { enabled: false } });
});

it.each([{ encodingFormat: 'application/pdf' }, { include: ['metadata'] }, { include: ['event-responses'] }])('keeps untrusted MIME out of option errors and audit records: %j', async options => {
  resource = { type: 'message', id: 'm1', attributes: { encodingFormat: 'private-mime https://private.invalid/file?token=secret-value', body: { text: 'hello' } } };
  const result = await call('get_message', { messageId: 'm1', options });
  expect(result).toMatchObject({ isError: true, structuredContent: { data: { partial: true, message: { id: 'm1', text: 'hello' }, errors: expect.any(Array) } } });
  const audit = await local.db.prepare("SELECT metadata_json FROM audit_log WHERE operation = 'get_message' AND outcome = 'failure'").all();
  expect(audit.results).toHaveLength(1);
  for (const output of [JSON.stringify(result), JSON.stringify(audit.results)]) {
    expect(output).not.toMatch(/private-mime|private\.invalid|secret-value/);
  }
});

it('guides proactive audio transcription and document reading through the unified tool', async () => {
  const discovery = await rpc('server/discover');
  const catalog = await rpc('tools/list');
  const description = catalog.tools?.find(tool => tool.name === 'get_message')?.description;
  for (const guidance of [discovery.instructions, description]) {
    expect(guidance).toContain('audio');
    expect(guidance).toContain('document');
    expect(guidance).toContain('transcript');
    expect(guidance).toContain('document-text');
    expect(guidance).toContain('even without an explicit');
  }
});

it('restores contact search through the authorized client, filtering and deduplicating before pagination', async () => {
  fetcher.mockImplementation(async (input, init) => {
    expect(new URL(String(input)).pathname).toBe('/user/contacts');
    expect(new URL(String(input)).searchParams.get('search')).toBe('ana & co');
    expect(new Headers(init?.headers).get('apikey')).toBe('synthetic-token');
    return Response.json({ jsonapi: { version: '1.1' }, data: [
      { type: 'chat', id: '1@s.whatsapp.net', attributes: { fullName: 'Ana & Co one', phoneNumber: '5511111111111' } },
      { type: 'chat', id: '1@s.whatsapp.net', attributes: { fullName: 'Ana & Co duplicate' } },
      { type: 'chat', id: '2@s.whatsapp.net', attributes: { pushName: 'Ana & Co two', phoneNumber: '5522222222222' } },
      { type: 'chat', id: '3@s.whatsapp.net', attributes: { fullName: 'Ana & Co three' } },
      { type: 'chat', id: 'other@s.whatsapp.net', attributes: { fullName: 'Other' } },
    ] });
  });
  const result = await call('search_contacts', { query: '  Ana & Co  ', options: { offset: 1, limit: 1 } });
  expect(result).toMatchObject({ structuredContent: { data: { connectionId, items: [{ id: '2@s.whatsapp.net', pushName: 'Ana & Co two', phoneNumber: '5522222222222' }], hasMore: true } } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('finds a contact by formatted phone digits on an explicitly selected owned connection', async () => {
  const owner = await bootstrapLocalUser(local.db, user);
  const second = await createConnection(local.db, key, { userId: owner.id, friendlyName: 'Work', instanceId: 'second', token: 'second-token' });
  fetcher.mockImplementation(async (_input, init) => {
    expect(new Headers(init?.headers).get('apikey')).toBe('second-token');
    return Response.json({ jsonapi: { version: '1.1' }, data: [{ type: 'chat', id: '5511987654321@s.whatsapp.net', attributes: { fullName: 'Contact' } }] });
  });
  expect(await call('search_contacts', { query: '+55 (11) 98765-4321', options: { connectionId: second.id } })).toMatchObject({ structuredContent: { data: { connectionId: second.id, items: [{ jid: '5511987654321@s.whatsapp.net' }], hasMore: false } } });
});
it.each([{ offset: -1 }, { limit: 0 }, { limit: 101 }, { offset: 1.5 }])('rejects invalid contact pagination %j before network access', async options => {
  expect(await call('search_contacts', { query: 'Ana', options })).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'invalid_options' } } } });
  expect(fetcher).not.toHaveBeenCalled();
});
it('does not read contacts from another user connection', async () => {
  const owner = await bootstrapLocalUser(local.db, { id: 'other', email: 'other@example.test', claims: {} });
  const foreign = await createConnection(local.db, key, { userId: owner.id, friendlyName: 'Foreign', instanceId: 'foreign', token: 'foreign-token' });
  expect(await call('search_contacts', { query: 'Ana', options: { connectionId: foreign.id } })).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'connection_not_found' } } } });
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(['', '   ', 'x'.repeat(201)])('rejects invalid contact query without reading contacts (%s)', async query => {
  expect(await call('search_contacts', { query })).toMatchObject({ isError: true });
  expect(fetcher).not.toHaveBeenCalled();
});
