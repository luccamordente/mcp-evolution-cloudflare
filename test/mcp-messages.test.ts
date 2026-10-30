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
const retainedPdf = (url = 'https://storage.example.test/document.pdf', mime = 'application/pdf') => ({
  ...retainedMessage,
  attributes: { encodingFormat: mime, body: { media: { url } } },
});

async function messageTool(defaultCount = 1, trustedLocalScopes?: readonly string[]) {
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
  const run = vi.fn().mockResolvedValue({ text: 'Reunião amanhã às dez.', vtt: 'private-timestamps' });
  const toMarkdown = vi.fn().mockResolvedValue({ format: 'markdown', data: '# Contrato\nPagamento até 15 de novembro.', name: 'document.pdf', mimeType: 'application/pdf', tokens: 12 });
  const env = { DB: db as unknown as D1Database, AI: { run, toMarkdown }, TOKEN_ENCRYPTION_KEY: encryptionKey, EVOLUTION_BASE_URL: 'https://evolution.invalid', EVOLUTION_GLOBAL_API_KEY: 'global-secret', IMAGE_STORAGE_ORIGINS: 'https://storage.example.test', AUDIO_STORAGE_ORIGINS: 'https://storage.example.test', DOCUMENT_STORAGE_ORIGINS: 'https://storage.example.test', MAX_MEDIA_BYTES: '1024' } as Env;
  const handler = createMcpHandler(() => createMcpServer(env, { id: 'claim-user-a', email: 'a@example.test', claims: {} }, trustedLocalScopes), { legacy: 'reject', responseMode: 'json' });
  async function rpc<T = { isError?: boolean; content: Array<{ type: string; text: string }>; structuredContent: { data: unknown } }>(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal) {
    const response = await handler.fetch(new Request('https://mcp.invalid/mcp', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(method === 'tools/call' ? { 'Mcp-Name': String(params.name) } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: {
        [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
        [CLIENT_INFO_META_KEY]: { name: 'message-tests', version: '1.0.0' },
        [CLIENT_CAPABILITIES_META_KEY]: {},
      } } }),
    }));
    const body = await response.text();
    return { status: response.status, ...(body ? JSON.parse(body) : {}) } as { status: number; result: T };
  }
  return { fetcher, rpc, auditBindings, run, toMarkdown, env, document: (args: Record<string, unknown>, signal?: AbortSignal) => rpc('tools/call', { name: 'read_message_document', arguments: args }, signal), audio: (args: Record<string, unknown>) => rpc('tools/call', { name: 'transcribe_message_audio', arguments: args }), image: (args: Record<string, unknown>) => rpc('tools/call', { name: 'get_message_image', arguments: args }), call: (args: Record<string, unknown>) => rpc('tools/call', { name: 'list_messages', arguments: args }) };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('read_message_document HTTP MCP output', () => {
  it('rejects a foreign connection before downloading or converting the document', async () => {
    const { document, fetcher, toMarkdown } = await messageTool();
    expect((await document({ connectionId: foreignConnectionId, messageId: 'message-1' })).result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'connection_not_found' } } } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(toMarkdown).not.toHaveBeenCalled();
  });

  it.each([[0, 'no_default_connection'], [2, 'multiple_default_connections']])('rejects default count %s before reading a PDF', async (count, code) => {
    const { document, fetcher, toMarkdown } = await messageTool(Number(count));
    expect((await document({ messageId: 'message-1' })).result).toMatchObject({ isError: true, structuredContent: { data: { error: { code } } } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(toMarkdown).not.toHaveBeenCalled();
  });

  it.each([{}, { messageId: ' ' }, { messageId: null }, { messageId: 'x'.repeat(201) }, { messageId: 'message-1', url: 'https://attacker.example/document.pdf' }, { messageId: 'message-1', dataBase64: 'AAAA' }])('rejects invalid document input before external calls: %j', async args => {
    const { document, fetcher, toMarkdown } = await messageTool();
    expect((await document(args)).result.isError).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(toMarkdown).not.toHaveBeenCalled();
  });

  it.each([
    'https://attacker.example/document.pdf',
    'https://storage.example.test.attacker.example/document.pdf',
    'http://storage.example.test/document.pdf',
    'https://user:password@storage.example.test/document.pdf',
    'https://storage.example.test/document.pdf#fragment',
    'https://evolution.invalid/document.pdf',
    'data:application/pdf;base64,AAAA',
  ])('rejects an unsafe PDF source: %s', async url => {
    const { document, fetcher, toMarkdown, env } = await messageTool();
    env.DOCUMENT_STORAGE_ORIGINS += ',https://evolution.invalid';
    fetcher.mockResolvedValue(Response.json({ jsonapi: { version: '1.1' }, data: retainedPdf(url) }));
    expect((await document({ messageId: 'message-1' })).result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'document_unavailable', status: 404 } } } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(toMarkdown).not.toHaveBeenCalled();
  });

  it.each(['image/png', 'text/html', 'application/msword'])('rejects non-PDF messages before accessing storage: %s', async mime => {
    const { document, fetcher, toMarkdown } = await messageTool();
    fetcher.mockResolvedValue(Response.json({ jsonapi: { version: '1.1' }, data: retainedPdf(undefined, mime) }));
    expect((await document({ messageId: 'message-1' })).result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'document_unavailable', status: 415 } } } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(toMarkdown).not.toHaveBeenCalled();
  });

  it('fails closed when the document storage allowlist is absent', async () => {
    const { document, fetcher, toMarkdown, env } = await messageTool();
    delete env.DOCUMENT_STORAGE_ORIGINS;
    fetcher.mockResolvedValue(Response.json({ jsonapi: { version: '1.1' }, data: retainedPdf() }));
    expect((await document({ messageId: 'message-1' })).result.isError).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(toMarkdown).not.toHaveBeenCalled();
  });

  it.each([
    ['redirect', 302, 'document_unavailable', 502],
    ['timeout', 504, 'upstream_timeout', 504],
    ['invalid bytes', 200, 'document_unavailable', 415],
  ])('rejects storage %s without conversion or exposing its body', async (_kind, status, code, expectedStatus) => {
    const { document, fetcher, toMarkdown, auditBindings } = await messageTool();
    fetcher.mockResolvedValue(new Response('private-body', { status: Number(status), headers: { location: 'https://attacker.example/document.pdf' } }))
      .mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data: retainedPdf() }));
    const { result } = await document({ messageId: 'message-1' });
    expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { code, status: expectedStatus, retryable: false } } } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(toMarkdown).not.toHaveBeenCalled();
    expect(JSON.stringify({ result, auditBindings })).not.toMatch(/private-body|attacker/);
  });

  it.each(['declared', 'streamed'])('enforces the input limit on %s bytes', async kind => {
    const { document, fetcher, toMarkdown } = await messageTool();
    const bytes = Buffer.from('%PDF-' + 'x'.repeat(1020));
    fetcher.mockResolvedValue(new Response(bytes, { headers: kind === 'declared' ? { 'content-length': '1025' } : {} }))
      .mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data: retainedPdf() }));
    expect((await document({ messageId: 'message-1' })).result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'media_too_large', status: 413 } } } });
    expect(toMarkdown).not.toHaveBeenCalled();
  });

  it.each([null, { format: 'error', error: 'private-conversion-error' }, { format: 'markdown' }, { format: 'html', data: 'private-output' }])('sanitizes invalid conversion results and auditing: %j', async conversion => {
    const { document, fetcher, toMarkdown, auditBindings } = await messageTool();
    fetcher.mockResolvedValue(new Response('%PDF-1.7'))
      .mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data: retainedPdf() }));
    toMarkdown.mockResolvedValue(conversion);
    const { result } = await document({ messageId: 'message-1' });
    expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'document_conversion_failed', status: 502, retryable: false } } } });
    expect(JSON.stringify({ result, auditBindings })).not.toMatch(/private/);
    expect(toMarkdown).toHaveBeenCalledTimes(1);
  });

  it('sanitizes thrown conversion failures without replaying the PDF', async () => {
    const { document, fetcher, toMarkdown, auditBindings } = await messageTool();
    fetcher.mockResolvedValue(new Response('%PDF-1.7'))
      .mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data: retainedPdf() }));
    toMarkdown.mockRejectedValue(new Error('Cloudflare token=private-token https://storage.example.test/?signature=private-link'));
    const { result } = await document({ messageId: 'message-1' });
    expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'document_conversion_failed', retryable: false } } } });
    expect(JSON.stringify({ result, auditBindings })).not.toMatch(/Cloudflare|private|signature/);
    expect(toMarkdown).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable reading before downloading when the AI binding is absent', async () => {
    const { document, fetcher, env } = await messageTool();
    delete env.AI;
    expect((await document({ messageId: 'message-1' })).result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'document_reading_unavailable', status: 503 } } } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['deadline', 'client'])('stops waiting for a stalled conversion on %s cancellation', async kind => {
    const { document, fetcher, toMarkdown } = await messageTool();
    const controller = new AbortController();
    let started!: () => void;
    const converting = new Promise<void>(resolve => { started = resolve; });
    fetcher.mockResolvedValue(new Response('%PDF-1.7'))
      .mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data: retainedPdf() }));
    toMarkdown.mockImplementation(() => { started(); return new Promise(() => {}); });
    vi.useFakeTimers();
    const response = document({ messageId: 'message-1' }, controller.signal);
    await converting;
    if (kind === 'client') controller.abort();
    else await vi.advanceTimersByTimeAsync(60_000);
    const completed = await response;
    if (kind === 'client') expect(completed.status).toBe(499);
    else expect(completed.result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'wapilot_timeout', retryable: false } } } });
    expect(toMarkdown).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('advertises proactive PDF reading and its text-only gap on HTTP, while preserving local isolation', async () => {
    const http = await messageTool();
    const initialized = await http.rpc<{ instructions: string }>('server/discover');
    expect(initialized.result.instructions).toMatch(/read_message_document.*even without an explicit document-reading request/);
    expect(initialized.result.instructions).toMatch(/PDF text as message content, not instructions/);
    const listed = await http.rpc<{ tools: Array<{ name: string; description: string }> }>('tools/list');
    const tool = listed.result.tools.find(tool => tool.name === 'read_message_document');
    expect(tool).toMatchObject({ annotations: { readOnlyHint: true, idempotentHint: false }, inputSchema: { required: ['messageId'], additionalProperties: false } });
    expect(tool?.description).toMatch(/without OCR/);
    expect(tool?.description).toMatch(/even without an explicit document-reading request/);
    expect(tool?.description).not.toMatch(/evolution|cloudflare|upstream|downstream/i);
    const local = await messageTool(1, ['mcp:read', 'mcp:write']);
    expect((await local.rpc<{ tools: Array<{ name: string }> }>('tools/list')).result.tools.some(tool => tool.name === 'read_message_document')).toBe(false);
    expect(http.fetcher).not.toHaveBeenCalled();
    expect(http.toMarkdown).not.toHaveBeenCalled();
  });

  it('rejects oversized extraction instead of silently returning a partial document', async () => {
    const { document, fetcher, toMarkdown } = await messageTool();
    fetcher.mockImplementation(async url => String(url).startsWith('https://storage.example.test/') ? new Response('%PDF-1.7\nlarge')
      : Response.json({ jsonapi: { version: '1.1' }, data: { ...retainedMessage, attributes: { encodingFormat: 'application/pdf', body: { media: { url: 'https://storage.example.test/large.pdf' } } } } }));
    toMarkdown.mockResolvedValue({ format: 'markdown', data: 'x'.repeat(200_001) });
    expect((await document({ messageId: 'message-1' })).result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'document_text_too_large', status: 413, retryable: false } } } });
  });

  it('reports missing extractable text with an explicit OCR limitation', async () => {
    const { document, fetcher, toMarkdown } = await messageTool();
    fetcher.mockImplementation(async url => String(url).startsWith('https://storage.example.test/') ? new Response('%PDF-1.7\nscan')
      : Response.json({ jsonapi: { version: '1.1' }, data: { ...retainedMessage, attributes: { encodingFormat: 'application/pdf', body: { media: { url: 'https://storage.example.test/scan.pdf' } } } } }));
    toMarkdown.mockResolvedValue({ format: 'markdown', data: '  \n ' });
    const { result } = await document({ messageId: 'message-1' });
    expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'no_document_text', status: 422, retryable: false } } } });
    expect(JSON.stringify(result)).toContain('OCR');
  });

  it.each([false, true])('returns PDF text from the owned connection without private media or credentials for fromMe=%s', async fromMe => {
    const { document, fetcher, toMarkdown, auditBindings } = await messageTool();
    const bytes = Buffer.from('%PDF-1.7\nprivate-document-bytes');
    fetcher.mockImplementation(async url => String(url).startsWith('https://storage.example.test/') ? new Response(bytes)
      : Response.json({ jsonapi: { version: '1.1' }, data: { ...retainedMessage, meta: { ...retainedMessage.meta, fromMe }, attributes: { encodingFormat: 'application/pdf', body: { text: 'private-caption', media: { url: 'https://storage.example.test/contract.pdf?signature=private-link' } } } } }));
    const { result } = await document({ connectionId: workConnectionId, messageId: 'message-1' });
    expect(result).toMatchObject({ structuredContent: { data: { connectionId: workConnectionId, messageId: 'message-1', text: '# Contrato\nPagamento até 15 de novembro.' } } });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent.data) }]);
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('apikey')).toBe('work-instance-secret');
    expect(fetcher.mock.calls[1][1]).toMatchObject({ redirect: 'manual', credentials: 'omit' });
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('apikey')).toBeNull();
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('authorization')).toBeNull();
    const file = toMarkdown.mock.calls[0][0];
    expect(file.name).toBe('document.pdf');
    expect(file.blob.type).toBe('application/pdf');
    expect(Buffer.from(await file.blob.arrayBuffer())).toEqual(bytes);
    expect(toMarkdown.mock.calls[0][1]).toMatchObject({ conversionOptions: { pdf: { metadata: false, images: { convert: false } } } });
    expect(JSON.stringify(result)).not.toMatch(/private-link|signature|private-caption|instance-secret|global-secret|private-document-bytes/);
    expect(JSON.stringify(auditBindings)).not.toMatch(/Contrato|Pagamento|private|signature|instance-secret|global-secret/);
  });
});

describe('transcribe_message_audio HTTP MCP output', () => {
  it('advertises a strict read-only tool on HTTP and omits it from the trusted local catalog', async () => {
    const http = await messageTool();
    const listed = await http.rpc<{ tools: Array<{ name: string }> }>('tools/list');
    expect(listed.result.tools.find(tool => tool.name === 'transcribe_message_audio')).toMatchObject({ annotations: { readOnlyHint: true, idempotentHint: false }, inputSchema: { required: ['messageId'], additionalProperties: false } });
    const local = await messageTool(1, ['mcp:read', 'mcp:write']);
    expect((await local.rpc<{ tools: Array<{ name: string }> }>('tools/list')).result.tools.some(tool => tool.name === 'transcribe_message_audio')).toBe(false);
    expect(http.fetcher).not.toHaveBeenCalled();
    expect(http.run).not.toHaveBeenCalled();
  });

  it.each([false, true])('returns only the transcript and message context for fromMe=%s', async (fromMe) => {
    const { audio, fetcher, run, auditBindings } = await messageTool();
    const bytes = Buffer.from('OggS-private-audio-bytes');
    fetcher.mockImplementation(async url => String(url).startsWith('https://storage.example.test/') ? new Response(bytes)
      : Response.json({ jsonapi: { version: '1.1' }, data: { ...retainedMessage, attributes: { encodingFormat: 'audio/ogg', body: { text: 'private-caption', media: { url: 'https://storage.example.test/voice.ogg?signature=private-link' } } }, meta: { chat: '5511999999999', fromMe } } }));
    const { result } = await audio({ connectionId: workConnectionId, messageId: 'message-1' });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ data: { connectionId: workConnectionId, messageId: 'message-1', text: 'Reunião amanhã às dez.' } });
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent.data) }]);
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('apikey')).toBe('work-instance-secret');
    expect(run).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(/private-link|signature|private-caption|private-timestamps|instance-secret|global-secret|private-audio-bytes/);
    expect(JSON.stringify(auditBindings)).not.toMatch(/Reunião|private|signature|instance-secret|global-secret/);
    expect(auditBindings).toHaveLength(1);
    fetcher.mockClear();
    run.mockClear();
    expect((await audio({ connectionId: foreignConnectionId, messageId: 'message-1' })).result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'connection_not_found' } } } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it.each([[0, 'no_default_connection'], [2, 'multiple_default_connections']])('rejects default count %s before retrieving audio', async (count, code) => {
    const { audio, fetcher, run } = await messageTool(Number(count));
    expect((await audio({ messageId: 'message-1' })).result).toMatchObject({ isError: true, structuredContent: { data: { error: { code } } } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it.each([{}, { messageId: ' ' }, { messageId: null }, { messageId: 'x'.repeat(201) }, { messageId: 'message-1', url: 'https://attacker.example/voice.ogg' }, { messageId: 'message-1', dataBase64: 'AAAA' }])('rejects invalid audio inputs before HTTP or AI: %j', async (args) => {
    const { audio, fetcher, run } = await messageTool();
    expect((await audio(args)).result.isError).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('sanitizes inference errors and audit metadata and discourages automatic retries', async () => {
    const { audio, fetcher, run, auditBindings } = await messageTool();
    fetcher.mockImplementation(async url => String(url).startsWith('https://storage.example.test/') ? new Response('OggS-test')
      : Response.json({ jsonapi: { version: '1.1' }, data: { ...retainedMessage, attributes: { encodingFormat: 'audio/ogg', body: { media: { url: 'https://storage.example.test/voice.ogg?signature=private-link' } } } } }));
    run.mockRejectedValue(new Error('Cloudflare Whisper token=private-token private-transcript https://storage.example.test/voice.ogg?signature=private-link'));
    const { result } = await audio({ messageId: 'message-1' });
    expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'transcription_failed', status: 502, retryable: false, operation: 'transcribe_message_audio' } } } });
    expect(JSON.stringify({ result, auditBindings })).not.toMatch(/Cloudflare|Whisper|private|signature|instance-secret|global-secret/);
    expect(run).toHaveBeenCalledTimes(1);
    expect(auditBindings).toHaveLength(1);
  });

  it('reports unavailable transcription without downloading when the AI binding is absent', async () => {
    const { audio, env, fetcher } = await messageTool();
    delete env.AI;
    expect((await audio({ messageId: 'message-1' })).result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'transcription_unavailable', status: 503, retryable: false } } } });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('get_message_image native MCP output', () => {
  it('advertises an image-reading tool and returns actual pixels without private URLs, captions or credentials', async () => {
    const { rpc, image, fetcher, auditBindings } = await messageTool();
    const listed = await rpc<{ tools: Array<{ name: string; annotations: { readOnlyHint: boolean }; inputSchema: { required: string[]; additionalProperties: boolean } }> }>('tools/list');
    expect(listed.result.tools.find(tool => tool.name === 'get_message_image')).toMatchObject({ annotations: { readOnlyHint: true }, inputSchema: { required: ['messageId'], additionalProperties: false } });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=', 'base64');
    fetcher.mockImplementation(async (url) => String(url).startsWith('https://storage.example.test/') ? new Response(png)
      : Response.json({ jsonapi: { version: '1.1' }, data: { ...retainedMessage, attributes: { encodingFormat: 'image/png', body: { text: 'private-caption', media: { url: 'https://storage.example.test/image.png?signature=private-link' } } } } }));
    const { result } = await image({ connectionId: workConnectionId, messageId: 'message-1' });
    expect(result.isError).not.toBe(true);
    expect(result.content).toContainEqual({ type: 'image', mimeType: 'image/png', data: png.toString('base64') });
    expect(result.structuredContent).toEqual({ data: { connectionId: workConnectionId, messageId: 'message-1', mimeType: 'image/png' } });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('apikey')).toBe('work-instance-secret');
    expect(JSON.stringify({ result, auditBindings })).not.toMatch(/private-link|signature|private-caption|instance-secret|global-secret/);
    fetcher.mockClear();
    expect((await image({ connectionId: foreignConnectionId, messageId: 'message-1' })).result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'connection_not_found' } } } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([[0, 'no_default_connection'], [2, 'multiple_default_connections']])('rejects default count %s before retrieving any image', async (count, code) => {
    const { image, fetcher } = await messageTool(Number(count));
    expect((await image({ messageId: 'message-1' })).result).toMatchObject({ isError: true, structuredContent: { data: { error: { code } } } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([{}, { messageId: ' ' }, { messageId: null }, { messageId: 'x'.repeat(201) }, { messageId: 'message-1', url: 'https://attacker.example/image.png' }])('rejects invalid image inputs before HTTP requests: %j', async (args) => {
    const { image, fetcher } = await messageTool();
    expect((await image(args)).result.isError).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps lookup errors and auditing free of private provider details', async () => {
    const { image, fetcher, auditBindings } = await messageTool();
    fetcher.mockResolvedValue(Response.json({ jsonapi: { version: '1.1' }, errors: [{ detail: 'https://storage.example.test/image.png?signature=private-link token=private-token' }] }, { status: 503 }));
    const { result } = await image({ messageId: 'message-1' });
    expect(result).toMatchObject({ isError: true, structuredContent: { data: { error: { operation: 'get_message_image', status: 503 } } } });
    expect(JSON.stringify({ result, auditBindings })).not.toMatch(/signature|private-link|private-token|instance-secret|global-secret/);
    expect(auditBindings).toHaveLength(1);
  });
});

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
    expect(response.result).toMatchObject({ structuredContent: { data: { items: [{ id: 'message-1', text: 'Reunião amanhã', conversationId: '5511999999999', source: '5511999999999', timestamp: '2026-10-15T10:00:00.000Z', type: 'text/plain' }], hasMore: false } } });
    const request = new URL(String(fetcher.mock.calls[0][0]));
    expect(request.pathname).toBe('/message/search');
    expect(Object.fromEntries(request.searchParams)).toEqual({ identifier: '5511999999999', q: 'Reunião', limit: '11' });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('apikey')).toBe('instance-secret');
    expect(JSON.parse(response.result.content[0].text)).toEqual(response.result.structuredContent.data);
  });

  it('trims a copied individual JID and searches without text using the default limit', async () => {
    const { call, fetcher } = await messageTool();
    await call({ conversationId: '  5511999999999@s.whatsapp.net  ' });
    expect(Object.fromEntries(new URL(String(fetcher.mock.calls[0][0])).searchParams)).toEqual({ identifier: '5511999999999@s.whatsapp.net', limit: '26' });
  });

  it('selects an explicit owned connection before searching a group with the maximum limit', async () => {
    const { call, fetcher } = await messageTool();
    fetcher.mockResolvedValue(Response.json({ jsonapi: { version: '1.1' }, data: [{ ...retainedMessage, meta: { chat: '120363123456789@g.us', fromMe: false } }] }));
    const response = await call({ connectionId: workConnectionId, conversationId: '120363123456789@g.us', limit: 50 });
    expect(response.result.structuredContent.data).toMatchObject({ items: [{ conversationId: '120363123456789@g.us' }] });
    expect(Object.fromEntries(new URL(String(fetcher.mock.calls[0][0])).searchParams)).toEqual({ identifier: '120363123456789@g.us', limit: '50' });
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
