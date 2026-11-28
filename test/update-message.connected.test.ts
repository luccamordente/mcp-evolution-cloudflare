import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { eventRuntime } from './helpers/mcp-events-runtime';

const fixtureURL = process.env.WAPILOT_ACTIONS_FIXTURE;
const directChat = '12025550123@s.whatsapp.net';
const groupChat = '120363000000001@g.us';
const imageOrigin = 'https://private-media.invalid';
const responseSchema = z.object({
  result: z.object({
    isError: z.boolean().optional(),
    structuredContent: z.object({ data: z.record(z.string(), z.unknown()) }),
  }),
});
const groupTargets = ['a1', 'b1', 'a2'].map(messageId => ({ conversationId: groupChat, messageId }));

describe.runIf(Boolean(fixtureURL))('message actions through the WaPilot Worker and Go HTTP', () => {
  let fixture: Awaited<ReturnType<typeof eventRuntime>>;
  let owner: Awaited<ReturnType<typeof fixture.issue>>;
  let provider: URL;
  let attachmentFetches = 0;

  beforeAll(async () => {
    provider = new URL(z.url().parse(fixtureURL));
    if (provider.protocol !== 'http:' || provider.hostname !== '127.0.0.1') {
      throw new Error('Expected the loopback message-action fixture.');
    }
    fixture = await eventRuntime(async request => {
      const requestURL = new URL(request.url);
      if (requestURL.origin === imageOrigin && requestURL.pathname === '/original.png') {
        attachmentFetches += 1;
        return new Response('synthetic image contents', { headers: { 'content-type': 'image/png' } });
      }
      if (requestURL.origin !== 'https://provider.invalid') {
        throw new Error('The acceptance fixture accepts Evolution Go requests only.');
      }
      const destination = new URL(provider);
      destination.pathname = requestURL.pathname;
      destination.search = requestURL.search;
      const headers = new Headers();
      for (const name of ['accept', 'apikey', 'content-type']) {
        const value = request.headers.get(name);
        if (value !== null) headers.set(name, value);
      }
      const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
      return fetch(destination, { method: request.method, headers, body, redirect: 'error', signal: request.signal });
    }, '9999', { IMAGE_STORAGE_ORIGINS: imageOrigin });
    owner = await fixture.issue({ email: 'connected-actions@example.test', scope: 'mcp:read mcp:write' });
  }, 30_000);

  afterAll(async () => { await fixture?.runtime.dispose(); });

  async function call(name: 'update_message' | 'get_message' | 'search_messages', args: Record<string, unknown>, options: Record<string, unknown> = {}) {
    const { response, body } = await fixture.rpc(owner.accessToken, 'tools/call', {
      name, arguments: { ...args, options: { connectionId: owner.connections[0], ...options } },
    }, { 'Mcp-Name': name });
    expect(response.status).toBe(200);
    return responseSchema.parse(body).result;
  }

  async function update(kind: string, messageId: string, fields: Record<string, unknown> = {}, conversationId = directChat) {
    const result = await call('update_message', { targets: [{ messageId, conversationId }], operation: { kind, ...fields } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.data).toMatchObject({ operation: kind, items: [{ conversationId, messageId, outcome: 'accepted' }] });
    return result.structuredContent.data;
  }

  async function captures() {
    const response = await fetch(new URL('/fixture/action-captures', provider));
    expect(response.status).toBe(200);
    return z.object({
      receipts: z.array(z.object({ ids: z.array(z.string()), chat: z.string(), sender: z.string(), types: z.array(z.string()).nullable() })).nullable(),
      sends: z.number(), patches: z.number(),
    }).parse(await response.json());
  }

  it('marks read and played in author partitions, preserving MCP order and replay protection', async () => {
    const targets = [...groupTargets, { conversationId: groupChat, messageId: 'missing' }];
    for (const kind of ['mark_read', 'mark_played']) {
      const args = { targets, operation: { kind } };
      const key = { idempotencyKey: `connected-${kind}` };
      const first = await call('update_message', args, key);
      const replay = await call('update_message', args, key);
      expect(first).toMatchObject({
        isError: true,
        structuredContent: { data: { operation: kind, items: [
          ...groupTargets.map(target => ({ ...target, outcome: 'accepted' })),
          { ...targets[3], outcome: 'rejected', error: { code: 'message_not_found', retryable: false } },
        ] } },
      });
      expect(replay).toEqual(first);
    }
    expect((await captures()).receipts).toEqual([
      { ids: ['a1', 'a2'], chat: groupChat, sender: '12025550124@s.whatsapp.net', types: null },
      { ids: ['b1'], chat: groupChat, sender: '30000000000125@lid', types: null },
      { ids: ['a1', 'a2'], chat: groupChat, sender: '12025550124@s.whatsapp.net', types: ['played'] },
      { ids: ['b1'], chat: groupChat, sender: '30000000000125@lid', types: ['played'] },
    ]);
  });

  it('edits and revokes messages and reads back the resulting retained records', async () => {
    const start = await captures();
    expect(await update('edit_text', 'edit-me', { text: 'edited through WaPilot' })).toMatchObject({
      items: [{ actionId: expect.stringMatching(/^synthetic-action-/) }],
    });
    expect((await call('get_message', { messageId: 'edit-me' })).structuredContent.data).toMatchObject({
      message: { id: 'edit-me', text: 'edited through WaPilot', editedAt: expect.any(String) },
    });
    const original = await call('get_message', { messageId: 'revoke-me' }, { include: ['attachments'] });
    const [attachment] = z.tuple([z.object({ downloadUrl: z.url(), downloadAvailable: z.literal(true) })]).parse(original.structuredContent.data.attachments);
    const attachmentURL = new URL(attachment.downloadUrl);
    expect(attachmentURL.origin).toBe('https://mcp.invalid');
    const downloadsBefore = attachmentFetches;
    const beforeRevoke = await fixture.fetch(attachmentURL.pathname);
    expect(beforeRevoke.status).toBe(200);
    expect(await beforeRevoke.text()).toBe('synthetic image contents');

    expect(await update('delete_for_everyone', 'revoke-me')).toMatchObject({
      items: [{ actionId: expect.stringMatching(/^synthetic-action-/) }],
    });
    const tombstone = await call('get_message', { messageId: 'revoke-me' }, { include: ['attachments'] });
    expect(tombstone.isError).not.toBe(true);
    expect(tombstone.structuredContent.data).toMatchObject({ message: { id: 'revoke-me', revokedAt: expect.any(String) } });
    expect(JSON.stringify(tombstone)).not.toContain('private original');
    expect(JSON.stringify(tombstone)).not.toContain('private-media.invalid');
    const search = await call('search_messages', {}, { conversationId: directChat, limit: 20, include: ['attachments'] });
    expect(search.isError).not.toBe(true);
    expect(search.structuredContent.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'edit-me', text: 'edited through WaPilot', editedAt: expect.any(String) }),
      expect.objectContaining({ id: 'revoke-me', revokedAt: expect.any(String), attachments: [] }),
    ]));
    expect(JSON.stringify(search)).not.toContain('private original');
    const afterRevoke = await fixture.fetch(attachmentURL.pathname);
    expect(afterRevoke.status).toBe(404);
    expect(await afterRevoke.json()).toMatchObject({ error: { code: 'attachment_not_found' } });
    expect(attachmentFetches - downloadsBefore).toBe(1);
    expect((await captures()).sends - start.sends).toBe(2);
  });

  it('sets, replaces, and removes a reaction, and applies and removes a label', async () => {
    const start = await captures();
    for (const emoji of ['👍', '❤️']) {
      await update('set_reaction', 'a1', { emoji }, groupChat);
      const result = await call('get_message', { messageId: 'a1' }, { include: ['reactions'] });
      expect(result.structuredContent.data).toMatchObject({ message: { reactions: [{ emoji }] } });
    }
    await update('remove_reaction', 'a1', {}, groupChat);
    const result = await call('get_message', { messageId: 'a1' }, { include: ['reactions'] });
    expect(result.structuredContent.data).toMatchObject({ message: { reactions: [] } });
    await update('add_label', 'owned-inbound', { labelId: '42' });
    await update('remove_label', 'owned-inbound', { labelId: '42' });
    const end = await captures();
    expect(end.sends - start.sends).toBe(3);
    expect(end.patches - start.patches).toBe(2);
  });
});
