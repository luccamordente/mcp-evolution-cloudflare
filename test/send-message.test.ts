import { getSendStatus } from '../src/lib/send-idempotency';
import { migrateToolArguments } from './helpers/tool-arguments';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { createMcpHandler, PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { createMcpServer } from '../src/lib/mcp';
import { createConnection, bootstrapLocalUser } from '../src/lib/db';
import { createTestD1 } from './helpers/local-d1';
import type { Env } from '../src/types';

const principal = { id: 'send-acceptance', email: 'send@example.test', claims: {} };
const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
let local: Awaited<ReturnType<typeof createTestD1>>;
let env: Env;
let connectionId: string;

async function rpc(method: string, params: Record<string, unknown> = {}, scopes = ['mcp:read', 'mcp:write']) {
  const handler = createMcpHandler(() => createMcpServer(env, principal), { legacy: 'reject', responseMode: 'json' });
  const response = await handler.fetch(new Request('https://mcp.invalid/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(method === 'tools/call' ? { 'Mcp-Name': String(params.name) } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: {
      [PROTOCOL_VERSION_META_KEY]: '2026-07-28', [CLIENT_INFO_META_KEY]: { name: 'send-acceptance', version: '1' }, [CLIENT_CAPABILITIES_META_KEY]: {},
    } } }),
  }), { authInfo: { token: 'test', clientId: 'test-client', scopes } });
  return z.object({ result: z.looseObject({ tools: z.array(z.looseObject({ name: z.string(), inputSchema: z.unknown().optional() })).optional(), isError: z.boolean().optional(), structuredContent: z.object({ data: z.record(z.string(), z.unknown()) }).optional(), _meta: z.unknown().optional() }) }).parse(await response.json());
}

beforeEach(async () => {
  local = await createTestD1();
  const owner = await bootstrapLocalUser(local.db, principal);
  connectionId = (await createConnection(local.db, key, { userId: owner.id, friendlyName: 'Acceptance', instanceId: 'instance', token: 'instance-token' })).id;
  env = { DB: local.db, TOKEN_ENCRYPTION_KEY: key, EVOLUTION_BASE_URL: 'https://provider.invalid', ENVIRONMENT: 'local' };
});
afterEach(async () => { vi.restoreAllMocks(); await local.dispose(); });

describe('unified send_message acceptance', () => {
  it('advertises one send tool and sends a quoted poll through MCP', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ jsonapi: { version: '1.1' }, data: { type: 'message', id: 'POLL', meta: { chat: '5511999999999' } } }));
    const catalog = await rpc('tools/list');
    expect(catalog.result.tools?.map((tool: { name: string }) => tool.name).filter((name: string) => /^(send_|reply_to_message|forward_message)/.test(name))).toEqual(['send_message']);
    const sent = await rpc('tools/call', { name: 'send_message', arguments: migrateToolArguments("send_message", { connectionId, message: {
      kind: 'poll', to: '5511999999999', question: 'Qual horário?', options: ['10h', '14h'], maxAnswers: 1, replyTo: { messageId: 'SOURCE' },
    } }) });
    expect(sent.result).toMatchObject({ structuredContent: { data: { connectionId, outcome: 'accepted', messageId: 'POLL' } } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe('https://provider.invalid/send/poll');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ data: {
      attributes: { maxAnswer: 1, body: { text: 'Qual horário?', options: ['10h', '14h'] } },
      relationships: { recipient: { data: { type: 'chat', id: '5511999999999' } }, quoted: { data: { type: 'message', id: 'SOURCE' } } },
    } });
  });
});

const recipient = '5511999999999';
const base64Source = { kind: 'base64', dataBase64: 'AQ==' };
const cases = [
  { message: { kind: 'text', to: '120363123456789@g.us', text: 'Olá', customMessageId: 'CUSTOM', delayMs: 20, mentions: { kind: 'users', jids: ['5511888888888'] }, replyTo: { messageId: 'SOURCE', participant: '5511888888888' } }, route: '/send/text', attributes: { body: { text: 'Olá' }, delay: 20, mentionedJid: ['5511888888888'] } },
  { message: { kind: 'link', to: recipient, text: 'Veja https://media.example.test/page' }, route: '/send/link', attributes: { body: { text: 'Veja https://media.example.test/page' } } },
  ...[
    ['image', 'image/png'], ['video', 'video/mp4'], ['voice_note', 'audio/ogg'], ['document', 'application/pdf'], ['gif', 'image/gif'],
  ].map(([kind, mimeType]) => ({ message: { kind, to: recipient, mimeType, source: base64Source, ...(kind === 'voice_note' ? {} : { caption: 'Amostra' }) }, route: '/send/media', attributes: { encodingFormat: mimeType, body: { ...(kind === 'voice_note' ? {} : { text: 'Amostra' }), media: { url: 'AQ==' } } } })),
  { message: { kind: 'list', to: recipient, title: 'Planos', description: 'Escolha', buttonText: 'Ver planos', footerText: 'WaPilot', sections: [{ title: 'Mensal', rows: [{ rowId: 'basic', title: 'Básico', description: 'R$ 29' }] }], replyTo: { messageId: 'SOURCE' } }, route: '/send/list', attributes: { body: { title: 'Planos', buttonText: 'Ver planos', sections: [{ title: 'Mensal', rows: [{ rowId: 'basic', title: 'Básico', description: 'R$ 29' }] }] } } },
  { message: { kind: 'location', to: recipient, name: 'Praça', latitude: -19.9, longitude: -43.9, address: 'Rua A' }, route: '/send/location', attributes: { body: { name: 'Praça', latitude: -19.9, longitude: -43.9, address: 'Rua A' } } },
  { message: { kind: 'contact', to: recipient, fullName: 'Pessoa', organization: 'Empresa', phone: '5511888888888' }, route: '/send/contact', attributes: { vcard: { fullName: 'Pessoa', organization: 'Empresa', phone: '5511888888888' } } },
  { message: { kind: 'buttons', to: recipient, title: 'Agenda', description: 'Escolha', footer: 'WaPilot', buttons: [{ kind: 'reply', label: 'Confirmar', id: 'confirm' }] }, route: '/send/button', attributes: { body: { buttons: [{ type: 'reply', displayText: 'Confirmar', id: 'confirm' }] } } },
  { message: { kind: 'status_text', text: 'Aberto hoje', customMessageId: 'STATUS' }, route: '/send/status/text', attributes: { body: { text: 'Aberto hoje' } } },
];

it.each(cases)('serializes the $message.kind signature through the public MCP boundary', async ({ message, route, attributes }) => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ jsonapi: { version: '1.1' }, data: { type: 'message', id: 'SENT' } }));
  env.SEND_MEDIA_ORIGINS = 'https://media.example.test';
  const sent = await rpc('tools/call', { name: 'send_message', arguments: migrateToolArguments("send_message", { message }) });
  expect(sent.result).toMatchObject({ structuredContent: { data: { outcome: 'accepted', messageId: 'SENT' } } });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toBe(`https://provider.invalid${route}`);
  const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(body).toMatchObject({ data: { type: 'message', attributes } });
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('apikey')).toBe('instance-token');
  if (message.kind === 'status_text') {
    expect(body.data.relationships).not.toHaveProperty('recipient');
    expect(sent.result).toMatchObject({ _meta: { sendReceipt: { to: 'Status', text: 'Aberto hoje' } } });
  } else expect(body.data.relationships.recipient.data.id).toBe(message.to);
});

it.each([
  { kind: 'poll', to: recipient, question: 'Quando?', options: ['a', 'a'] },
  { kind: 'poll', to: recipient, question: 'Quando?', options: ['a', 'b'], maxAnswers: 3 },
  { kind: 'poll', to: recipient, question: 'Quando?', options: ['a', 'b'], caption: 'Invalid field' },
  { kind: 'list', to: recipient, title: 'Menu', description: 'Escolha', buttonText: 'Abrir', footerText: 'WaPilot', sections: [] },
  { kind: 'list', to: recipient, title: 'Menu', description: 'Escolha', buttonText: 'Abrir', footerText: 'WaPilot', sections: [{ rows: [{ rowId: 'same', title: 'A' }, { rowId: 'same', title: 'B' }] }] },
  { kind: 'buttons', to: recipient, title: 'Menu', description: 'Escolha', footer: 'WaPilot', buttons: [{ kind: 'reply', label: 'Sim', id: 'yes' }, { kind: 'url', label: 'Site', url: 'https://example.test/' }] },
  { kind: 'buttons', to: recipient, title: 'Menu', description: 'Escolha', footer: 'WaPilot', buttons: [{ kind: 'pix', label: 'Pagar', key: 'secret' }] },
  { kind: 'text', to: recipient, text: 'Olá', replyTo: { participant: '5511' } },
  { kind: 'image', to: recipient, mimeType: 'application/pdf', source: base64Source },
  { kind: 'document', to: recipient, mimeType: 'text/plain', source: base64Source },
  { kind: 'event', to: recipient, name: 'Reunião' },
  { kind: 'template', to: recipient, name: 'Modelo' },
  { kind: 'text', to: recipient, text: 'Hello', mentions: { kind: 'all' } },
  { kind: 'voice_note', to: recipient, mimeType: 'audio/ogg', source: base64Source, caption: 'Ignored by native voice notes' },
  { kind: 'audio', to: recipient, mimeType: 'audio/ogg', source: base64Source },
  { kind: 'video_note', to: recipient, mimeType: 'video/mp4', source: base64Source },
])('rejects invalid or unimplemented signature $kind before dispatch', async message => {
  const fetcher = vi.spyOn(globalThis, 'fetch');
  const result = await rpc('tools/call', { name: 'send_message', arguments: migrateToolArguments("send_message", { message }) });
  expect(result.result.isError).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});

it('checks write permission before attachment decoding or origin checks', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch');
  const result = await rpc('tools/call', { name: 'send_message', arguments: migrateToolArguments("send_message", { message: { kind: 'image', to: recipient, mimeType: 'image/png', source: { kind: 'base64', dataBase64: 'invalid!!' } } }) }, ['mcp:read']);
  expect(result.result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'insufficient_scope' }, outcome: 'failed' } } });
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects unapproved downloads without sending or leaking their URL', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch');
  const result = await rpc('tools/call', { name: 'send_message', arguments: migrateToolArguments("send_message", { message: { kind: 'sticker', to: recipient, url: 'https://unapproved.invalid/private-file' } }) });
  expect(result.result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'media_origin_not_allowed' }, outcome: 'failed' } } });
  expect(JSON.stringify(result)).not.toContain('unapproved.invalid');
  expect(fetcher).not.toHaveBeenCalled();
});

it('maps approved interactive downloads and callback destinations without mixing their schemas', async () => {
  env.SEND_MEDIA_ORIGINS = 'https://media.example.test';
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ jsonapi: { version: '1.1' }, data: { type: 'message', id: 'CARD' } }));
  const message = { kind: 'carousel', to: recipient, cards: [{ header: { imageUrl: 'https://media.example.test/card.jpg' }, body: { text: 'Oferta' }, buttons: [{ kind: 'url', label: 'Ver', url: 'https://example.test/product' }] }] };
  expect((await rpc('tools/call', { name: 'send_message', arguments: migrateToolArguments("send_message", { message }) })).result.isError).not.toBe(true);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ data: { attributes: { cards: [{ header: message.cards[0].header, body: { text: 'Oferta' }, buttons: [{ type: 'URL', displayText: 'Ver', id: 'https://example.test/product' }] }] } } });
});

it('allows storage carousel cards with production config and rejects other origins before dispatch', async () => {
  const { vars } = z.object({ vars: z.object({ SEND_MEDIA_ORIGINS: z.string().optional() }) }).parse(JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')));
  env.SEND_MEDIA_ORIGINS = vars.SEND_MEDIA_ORIGINS;
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ jsonapi: { version: '1.1' }, data: { type: 'message', id: 'CAROUSEL' } }));
  const message = { kind: 'carousel', to: recipient, cards: [1, 2].map(index => ({ header: { imageUrl: 'https://storage.neurau.com.br/synthetic-card.jpg' }, body: { text: `Cartão ${index}` } })) };
  const sent = await rpc('tools/call', { name: 'send_message', arguments: migrateToolArguments("send_message", { message }) });
  expect(sent.result).toMatchObject({ structuredContent: { data: { outcome: 'accepted', messageId: 'CAROUSEL' } } });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toBe('https://provider.invalid/send/carousel');
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ data: { attributes: { cards: message.cards } } });

  message.cards[1].header.imageUrl = 'https://storage.neurau.com.br.unapproved.invalid/card.jpg';
  const rejected = await rpc('tools/call', { name: 'send_message', arguments: migrateToolArguments("send_message", { message }) });
  expect(rejected.result).toMatchObject({ isError: true, structuredContent: { data: { outcome: 'failed', error: { code: 'media_origin_not_allowed' } } } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(['pending', 'unknown', 'completed'])('fences a %s legacy action key and keeps its status queryable', async state => {
  const owner = await bootstrapLocalUser(local.db, principal);
  await local.db.prepare('INSERT INTO send_operations (id,user_id,connection_id,operation,idempotency_key,arguments_hash,state,result_json,expires_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind('legacy', owner.id, connectionId, 'send_text', 'original-key', 'old-hash', state, state === 'completed' ? JSON.stringify({ accepted: true, messageId: 'OLD' }) : null, Date.now() + 86400000).run();
  const fetcher = vi.spyOn(globalThis, 'fetch');
  const sent = await rpc('tools/call', { name: 'send_message', arguments: migrateToolArguments("send_message", { idempotencyKey: 'original-key', message: { kind: 'text', to: recipient, text: 'Do not duplicate' } }) });
  expect(sent.result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'send_legacy_action_exists', retryable: false } } } });
  expect(fetcher).not.toHaveBeenCalled();
  const status = await getSendStatus(local.db, { userId: owner.id, connectionId, operation: 'send_text', key: 'original-key' });
  expect(status).toMatchObject({ outcome: state === 'completed' ? 'accepted' : state });
});

it('fences an older Worker from reserving a key already used by the unified tool', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ jsonapi: { version: '1.1' }, data: { type: 'message', id: 'NEW' } }));
  await rpc('tools/call', { name: 'send_message', arguments: migrateToolArguments("send_message", { idempotencyKey: 'new-key', message: { kind: 'text', to: recipient, text: 'One action' } }) });
  const owner = await bootstrapLocalUser(local.db, principal);
  await expect(local.db.prepare('INSERT INTO send_operations (id,user_id,connection_id,operation,idempotency_key,arguments_hash,state,expires_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind('old-worker', owner.id, connectionId, 'send_text', 'new-key', 'old-hash', 'pending', Date.now() + 86400000).run()).rejects.toThrow('send_legacy_action_exists');
});

it('rejects link-preview metadata downloads outside approved origins', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch');
  const sent = await rpc('tools/call', { name: 'send_message', arguments: migrateToolArguments("send_message", { message: { kind: 'link', to: recipient, text: 'https://unapproved.invalid/private' } }) });
  expect(sent.result).toMatchObject({ isError: true, structuredContent: { data: { error: { code: 'media_origin_not_allowed' } } } });
  expect(fetcher).not.toHaveBeenCalled();
});

it('allows a unified action after the legacy key expires without waiting for cleanup', async () => {
  const owner = await bootstrapLocalUser(local.db, principal);
  await local.db.prepare('INSERT INTO send_operations (id,user_id,connection_id,operation,idempotency_key,arguments_hash,state,expires_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind('expired', owner.id, connectionId, 'send_media', 'expired-key', 'old-hash', 'unknown', Date.now() - 1).run();
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ jsonapi: { version: '1.1' }, data: { type: 'message', id: 'AFTER-EXPIRY' } }));
  const result = await rpc('tools/call', { name: 'send_message', arguments: migrateToolArguments("send_message", { idempotencyKey: 'expired-key', message: { kind: 'text', to: recipient, text: 'A new action after expiry' } }) });
  expect(result.result).toMatchObject({ structuredContent: { data: { outcome: 'accepted', messageId: 'AFTER-EXPIRY' } } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('refuses a direct retained lookup from a different source conversation', async () => {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async request => {
    const url = new URL(String(request));
    calls.push(url.pathname);
    return Response.json({ jsonapi: { version: '1.1' }, data: url.pathname === '/message/search' ? [] : {
      type: 'message', id: 'SOURCE', attributes: { encodingFormat: 'text/plain', body: { text: 'Retained elsewhere' } }, meta: { chat: '5511777777777' },
    } });
  });
  const result = await rpc('tools/call', { name: 'send_message', arguments: migrateToolArguments("send_message", { message: { kind: 'forward', to: recipient, source: { conversationId: '5511888888888', messageId: 'SOURCE' } } }) });
  expect(result.result.isError).toBe(true);
  expect(calls).toEqual(['/message/search', '/message/status']);
});

it.each(['https://media。example.test/page', 'https://media.example.test/~user'])('rejects link previews whose URL spelling changes the backend target: %s', async url => {
  env.SEND_MEDIA_ORIGINS = 'https://media.example.test';
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ jsonapi: { version: '1.1' }, data: { type: 'message', id: 'UNEXPECTED' } }));
  const result = await rpc('tools/call', { name: 'send_message', arguments: migrateToolArguments("send_message", { message: { kind: 'link', to: recipient, text: `Veja ${url}` } }) });
  expect(result.result.isError).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});
