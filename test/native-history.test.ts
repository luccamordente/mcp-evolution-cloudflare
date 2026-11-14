import { migrateToolCall } from './helpers/tool-arguments';
import { z } from 'zod';
import { nativeMessageSchema, responsePageSchema } from '../src/lib/native-message';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMcpHandler, PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { createMcpServer } from '../src/lib/mcp';
import { createConnection, bootstrapLocalUser } from '../src/lib/db';
import { EvolutionGoClient } from '../src/lib/evolution';
import { createTestD1 } from './helpers/local-d1';
import type { Env } from '../src/types';

const fixtures = [
  { interactive: { kind: 'list', title: 'Menu', sections: [{ rows: [{ id: 'a', title: 'A' }] }] } },
  { interactiveResponse: { kind: 'button', id: 'a', originMessageId: 'origin' } },
  { poll: { question: 'Choose', options: [{ id: 'a', name: 'A' }], selectableOptionsCount: 1 } },
  { event: { name: 'Meeting', startTime: 1795197600, isCanceled: false, location: { latitude: 0, longitude: 0 } } },
  { eventResponse: { eventMessageId: 'event', response: 'GOING', timestampMS: 1795197600000, extraGuestCount: 0 } },
];
const resource = (body: unknown, related = '/messages/fixture/event-responses') => ({ type: 'message', id: 'fixture', attributes: { encodingFormat: 'application/vnd.whatsapp.event', body }, relationships: { eventResponses: { links: { related } } } });
function client(body: unknown, related?: string) {
  return new EvolutionGoClient({ baseUrl: 'https://provider.invalid', instanceId: 'instance', instanceToken: 'synthetic-token', fetcher: async () => Response.json({ jsonapi: { version: '1.1' }, data: resource(body, related) }) });
}

describe('native retained history boundary', () => {
  it.each(fixtures)('retains structured content without text or media', async body => {
    const message = await client(body).getMessage('fixture');
    expect(message).toMatchObject(body);
    expect(message?.contentUnavailable).toBeUndefined();
  });
  it('strips provider secrets and rejects malformed content', async () => {
    const good = await client({ event: { name: 'Meeting', messageSecret: 'private' }, rawMessage: 'private' }).getMessage('fixture');
    expect(JSON.stringify(good)).not.toContain('private');
    const bad = await client({ event: { name: 17 } }).getMessage('fixture');
    expect(bad).toMatchObject({ contentUnavailable: true });
    expect(bad?.event).toBeUndefined();
  });
  it.each(['https://foreign.invalid/messages/fixture/event-responses', '//foreign.invalid/messages/fixture/event-responses', '/messages/other/event-responses'])('rejects an unauthorized related link %s', async related => {
    const message = await client(fixtures[3], related).getMessage('fixture');
    expect(message?.responseLinks).toBeUndefined();
  });
});

describe('response page boundary', () => {
  const row = { type: 'event-response', id: 'r', attributes: { eventMessageId: 'fixture', respondentJid: '2@s.whatsapp.net', responseMessageId: 'reply', response: 'GOING', timestampMS: 123 } };
  function paged(next: string | null, target = 'fixture') {
    const calls: { path: string; token: string | null; redirect: RequestRedirect | undefined }[] = [];
    const c = new EvolutionGoClient({ baseUrl: 'https://provider.invalid', instanceId: 'instance', instanceToken: 'synthetic-token', fetcher: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname + url.search, token: new Headers(init?.headers).get('apikey'), redirect: init?.redirect });
      return Response.json({ jsonapi: { version: '1.1' }, ...(url.pathname === '/message/status' ? { data: resource(fixtures[3]) } : { data: [{ ...row, attributes: { ...row.attributes, eventMessageId: target } }], links: { next }, meta: { coverage: 'observed', consistency: 'eventually-consistent-current-state' } }) });
    } });
    return { c, calls };
  }
  it('preserves coverage, sends instance auth and follows an opaque cursor', async () => {
    const { c, calls } = paged('/messages/fixture/event-responses?page%5Bcursor%5D=signed%2Bcursor');
    const page = await c.listMessageResponses('fixture', 'eventResponses', 10, 'previous+cursor');
    expect(page).toMatchObject({ hasMore: true, nextCursor: 'signed+cursor', meta: { coverage: 'observed' } });
    expect(calls[1]).toEqual({ path: '/messages/fixture/event-responses?page%5Blimit%5D=10&page%5Bcursor%5D=previous%2Bcursor', token: 'synthetic-token', redirect: 'manual' });
  });
  it.each(['https://foreign.invalid/messages/fixture/event-responses?page%5Bcursor%5D=x', '/messages/other/event-responses?page%5Bcursor%5D=x', '/messages/fixture/event-responses'])('rejects unsafe continuation %s', async next => {
    const { c } = paged(next);
    await expect(c.listMessageResponses('fixture', 'eventResponses')).rejects.toMatchObject({ status: 502 });
  });
  it('preserves ambiguous poll state without asserting an option', () => {
    const attributes = { pollMessageId: 'fixture', pollChatJid: 'group@g.us', voteMessageId: 'reply', voterJid: '2@s.whatsapp.net', votedAt: '2026-11-11T00:00:00Z', receivedAt: '2026-11-11T00:00:00Z', orderingState: 'ambiguous', identityProvenance: 'exact', diagnostic: { state: 'ambiguous', reason: 'conflicting_protocol_timestamp' } };
    const document = { data: [{ type: 'poll-vote', id: 'vote', attributes }], links: {}, meta: { coverage: 'observed' } };
    expect(responsePageSchema.safeParse(document).success).toBe(true);
    expect(responsePageSchema.safeParse({ ...document, data: [{ ...document.data[0], attributes: { ...attributes, selectedOptions: ['unproven'] } }] }).success).toBe(false);
  });
  it('rejects rows from another message', async () => {
    const { c } = paged(null, 'other');
    await expect(c.listMessageResponses('fixture', 'eventResponses')).rejects.toMatchObject({ status: 502 });
  });
});

const backendUrl = process.env.WAPILOT_HISTORY_ACCEPTANCE_URL;
const principal = { id: 'history-acceptance', email: 'history@example.test', claims: {} };
let local: Awaited<ReturnType<typeof createTestD1>>;
let env: Env;
let connectionId: string;
async function call(name: string, args: Record<string, unknown>) {
  const migrated = migrateToolCall({ name, arguments: { connectionId, ...args } });
  name = String(migrated.name);
  args = migrated.arguments as Record<string, unknown>;
  const handler = createMcpHandler(() => createMcpServer(env, principal), { legacy: 'reject', responseMode: 'json' });
  const response = await handler.fetch(new Request('https://mcp.invalid/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': name },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, _meta: { [PROTOCOL_VERSION_META_KEY]: '2026-07-28', [CLIENT_INFO_META_KEY]: { name: 'history-acceptance', version: '1' }, [CLIENT_CAPABILITIES_META_KEY]: {} } } }),
  }), { authInfo: { token: 'test', clientId: 'history-acceptance', scopes: ['mcp:read'] } });
  return z.object({ result: z.object({ isError: z.boolean().optional(), structuredContent: z.object({ data: z.object({ message: nativeMessageSchema.optional(), items: z.array(z.object({ id: z.string() })).optional(), meta: z.object({ coverage: z.string() }).optional(), nextCursor: z.string().optional() }).loose() }) }) }).parse(await response.json());
}

describe.runIf(Boolean(backendUrl))('H-A8 real MCP and Go HTTP history', () => {
  beforeAll(async () => {
    local = await createTestD1();
    const owner = await bootstrapLocalUser(local.db, principal);
    const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    connectionId = (await createConnection(local.db, key, { userId: owner.id, friendlyName: 'History acceptance', instanceId: 'fixture', token: process.env.WAPILOT_HISTORY_ACCEPTANCE_TOKEN ?? 'synthetic-owner' })).id;
    env = { DB: local.db, TOKEN_ENCRYPTION_KEY: key, EVOLUTION_BASE_URL: backendUrl ?? '', ENVIRONMENT: 'local' };
  });
  afterAll(async () => local?.dispose());
  it('reads structured-only messages and follows both authenticated relationships across pages', async () => {
    const listing = await call('list_messages', { limit: 50 });
    expect(listing.result?.isError, JSON.stringify(listing)).not.toBe(true);
    for (const kind of ['interactive', 'interactiveResponse', 'poll', 'event', 'eventResponse'] as const) {
      const result = await call('get_message', { messageId: `synthetic-${kind}` });
      expect(result.result?.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.result.structuredContent.data.message?.[kind]).toBeDefined();
      expect(JSON.stringify(result)).not.toContain('messageSecret');
    }
    for (const [messageId, relationship] of [['synthetic-poll', 'votes'], ['synthetic-event', 'eventResponses']]) {
      let cursor: string | undefined;
      const ids = new Set<string>();
      let pages = 0;
      do {
        const result = await call('list_message_responses', { messageId, relationship, limit: 100, offset: ids.size });
        expect(result.result?.isError, JSON.stringify(result)).not.toBe(true);
        const page = z.object({ items: z.array(z.object({ id: z.string() })), meta: z.object({ coverage: z.string() }), hasMore: z.boolean() }).parse(result.result.structuredContent.data[relationship === 'votes' ? 'poll-responses' : 'event-responses']);
        expect(page.meta?.coverage).toBe('observed');
        expect(page.items?.length).toBeLessThanOrEqual(100);
        for (const item of page.items ?? []) { expect(ids.has(item.id)).toBe(false); ids.add(item.id); }
        cursor = page.hasMore ? 'more' : undefined;
        pages++;
        expect(pages).toBeLessThan(20);
      } while (cursor);
      expect(pages).toBeGreaterThan(1);
      expect(ids.size).toBe(500);
    }
  }, 60000);
});
