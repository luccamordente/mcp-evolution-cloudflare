import { migrateToolArguments, migrateToolCall } from './helpers/tool-arguments';
import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { unstable_splitSqlQuery } from 'wrangler';
import { decryptToken } from '../src/lib/crypto';
import { eventRuntime } from './helpers/mcp-events-runtime';

it('removes legacy content on upgrade, preserves identity and operational state, and completes the public event-to-send cycle', async () => {
  const callbacks: Array<{ body: string }> = [];
  let providerWrites = 0;
  const fixture = await eventRuntime(async request => {
    if (new URL(request.url).hostname === 'sender.invalid') {
      const input = await request.json() as { body: string };
      const event = JSON.parse(input.body);
      if (event.type !== 'verification') callbacks.push(input);
      return Response.json({ status: 202, body: JSON.stringify({ challenge: event.challenge }) });
    }
    expect(request.headers.get('apikey')).toBe('synthetic-instance');
    const path = new URL(request.url).pathname;
    if (path === '/message/status' && (await request.json() as { data: { id: string } }).data.id !== 'cycle-message') {
      return Response.json({ jsonapi: { version: '1.1' }, errors: [{ status: '404' }] }, { status: 404 });
    }
    const data = path === '/message/status'
      ? { type: 'message', id: 'cycle-message', attributes: { encodingFormat: 'text/plain', body: { text: 'Texto completo sintético 🌎' } }, meta: { chat: 'cycle-chat' } }
      : path === '/send/text' ? { type: 'message', id: `sent-${++providerWrites}`, meta: { chat: 'cycle-chat' } } : [];
    return Response.json({ jsonapi: { version: '1.1' }, data });
  }, '0008_event_deliveries.sql');
  try {
    const account = await fixture.issue({ scope: 'mcp:read mcp:write' });
    const connectionId = account.connections[0];
    const hook = await fixture.webhook(connectionId);
    const input = { name: 'message.received', arguments: { connectionId }, delivery: { mode: 'webhook', url: 'https://receiver.example.test/cycle', secret: 'whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=' } };
    const subscribed = await fixture.rpc(account.accessToken, 'events/subscribe', input);
    expect(subscribed.body.result.id).toMatch(/^sub_/);
    const receivedAt = Date.now();
    const payload = { jsonapi: { version: '1.1' }, meta: { event: 'Message', instanceId: hook.instanceId }, data: { type: 'message', id: 'cycle-message', attributes: { at: receivedAt, encodingFormat: 'text/plain', body: { text: 'Prévia sintética' } }, relationships: { author: { data: { type: 'chat', id: 'synthetic-author' } } }, meta: { chat: 'cycle-chat', fromMe: false } } };
    const ingress = () => fixture.fetch(hook.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect((await ingress()).status).toBe(202);
    const jobs = fixture.published.splice(0);
    expect(jobs).toEqual([expect.any(String)]);
    await fixture.db.batch([
      fixture.db.prepare("INSERT INTO webhook_events (id,connection_id,event_name,message_id,message_json) VALUES ('legacy-hook',?,'Message','legacy-message',?)").bind(connectionId, '{"text":"legacy private body"}'),
      fixture.db.prepare("INSERT INTO outbound_messages (connection_id,message_id,encoding_format,text,media_json,sent_at) VALUES (?,'legacy-send','text/plain','legacy private send','{\"url\":\"https://private.invalid/file\"}',datetime('now'))").bind(connectionId),
      fixture.db.prepare("INSERT INTO oauth_clients (client_id,client_name,redirect_uris_json) VALUES ('preserved-client','Synthetic','[]')"),
      fixture.db.prepare("INSERT INTO event_grant_revocations (user_id,grant_id,expires_at) VALUES (?,'other-revoked-grant',?)").bind(account.userId, receivedAt + 7 * 86400000),
      fixture.db.prepare("INSERT INTO send_operations (id,user_id,connection_id,operation,idempotency_key,arguments_hash,state,result_json,expires_at) VALUES ('preserved-op',?,?,'send_text','prior-action','synthetic-hash','completed','{\"messageId\":\"prior-send\"}',?)").bind(account.userId, connectionId, receivedAt + 86400000),
      fixture.db.prepare("INSERT INTO audit_log (id,user_id,connection_id,operation,outcome) VALUES ('preserved-audit',?,?,'send_text','success')").bind(account.userId, connectionId),
    ]);
    const tables = ['users', 'whatsapp_connections', 'oauth_clients', 'audit_log', 'event_subscriptions', 'event_grant_revocations', 'event_sources', 'event_deliveries', 'send_operations'];
    const before = await Promise.all(tables.map(table => fixture.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));
    const grants = await (await fixture.fetch('/fixture/grants?'+new URLSearchParams({ user: encodeURIComponent('fixture-a@example.test') }))).json();
    expect(grants).toMatchObject({ items: [expect.objectContaining({ id: account.grantId })] });
    const migration = await readFile('migrations/0009_drop_legacy_message_storage.sql', 'utf8');
    await fixture.db.batch(unstable_splitSqlQuery(migration).map(sql => fixture.db.prepare(sql)));
    const schema = await fixture.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
    expect(schema.results.map(row => row.name)).not.toContain('webhook_events');
    expect(schema.results.map(row => row.name)).not.toContain('outbound_messages');
    for (const [index, table] of tables.entries()) expect((await fixture.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results).toEqual(before[index].results);
    expect(await fixture.db.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] });
    const connection = await fixture.db.prepare('SELECT encrypted_token FROM whatsapp_connections WHERE id = ?').bind(connectionId).first<{ encrypted_token: string }>();
    expect(await decryptToken(connection!.encrypted_token, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe('synthetic-instance');
    expect(await (await fixture.fetch('/fixture/grants?'+new URLSearchParams({ user: encodeURIComponent('fixture-a@example.test') }))).json()).toEqual(grants);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const params = name === 'send_message' ? { name, arguments: migrateToolArguments(name, args) } : migrateToolCall({ name, arguments: args });
      return (await fixture.rpc(account.accessToken, 'tools/call', params, { 'Mcp-Name': String(params.name) })).body.result;
    };
    expect((await call('list_connections')).structuredContent.data.items.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(account.connections));
    await fixture.queue(jobs);
    expect(callbacks).toHaveLength(1);
    expect(JSON.parse(callbacks[0].body).data.messageId).toBe('cycle-message');
    const read = await call('get_message', { connectionId, messageId: 'cycle-message' });
    expect(read.structuredContent.data).toMatchObject({ connectionId, message: { id: 'cycle-message', text: 'Texto completo sintético 🌎' } });
    const args = { connectionId, idempotencyKey: 'cycle-action', message: { kind: 'text', to: 'cycle-chat', text: 'Resposta sintética' } };
    const sent = await call('send_message', args);
    expect(sent.isError).not.toBe(true);
    expect(sent.structuredContent.data.messageId).toBe('sent-1');
    const repeated = await call('send_message', args);
    expect(repeated.structuredContent).toEqual(sent.structuredContent);
    expect(sent).toMatchObject({ _meta: { sendReceipt: { state: 'accepted' } } });
    expect(repeated).toMatchObject({ _meta: { sendReceipt: { state: 'accepted' } } });
    expect(providerWrites).toBe(1);
    expect((await call('list_messages', { connectionId })).structuredContent.data.items).toEqual([]);
    const unavailable = await call('send_message', { connectionId, message: { kind: 'forward', to: 'cycle-chat', source: { conversationId: 'cycle-chat', messageId: 'legacy-send' } } });
    expect(unavailable.isError).toBe(true);
    expect(unavailable.structuredContent.data.error.status).toBe(404);
    expect(providerWrites).toBe(1);
    // The existing cancellation/revocation and exact one-hour/24-hour suites use this same final schema.
    expect((await fixture.scheduled(Number((await fixture.db.prepare('SELECT MAX(expires_at) AS expiry FROM event_sources').first())?.expiry))).outcome).toBe('ok');
    expect((await fixture.db.prepare('SELECT * FROM event_sources').all()).results).toEqual([]);
    expect((await fixture.db.prepare('SELECT * FROM event_deliveries').all()).results).toEqual([]);
  } finally { await fixture.runtime.dispose(); }
}, 30_000);
