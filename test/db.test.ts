import { describe, expect, it } from 'vitest';
import { validateWebhookEvent, listConnections, removeConnection, resolveConnection } from '../src/lib/db';
import { createTestD1 } from './helpers/local-d1';

describe('connection defaults', () => {
  it('scopes removal to the owner, promotes the oldest remaining default and handles the last row', async () => {
    const { db, dispose } = await createTestD1();
    try {
      await db.prepare("INSERT INTO users (id, email) VALUES ('owner', 'owner@example.test'), ('other', 'other@example.test')").run();
      await db.prepare(`
        INSERT INTO whatsapp_connections (id, user_id, friendly_name, instance_id, encrypted_token, is_default, created_at) VALUES
          ('default', 'owner', 'Default', 'instance-1', 'fixture', 1, '2026-10-15 10:00:00'),
          ('newer', 'owner', 'Newer', 'instance-2', 'fixture', 0, '2026-10-15 12:00:00'),
          ('older', 'owner', 'Older', 'instance-3', 'fixture', 0, '2026-10-15 11:00:00'),
          ('foreign', 'other', 'Foreign', 'instance-4', 'fixture', 0, '2026-10-15 09:00:00')
      `).run();

      await expect(removeConnection(db, 'other', 'default')).resolves.toBe(false);
      await expect(resolveConnection(db, 'owner')).resolves.toMatchObject({ id: 'default' });

      await expect(removeConnection(db, 'owner', 'default')).resolves.toBe(true);
      expect(await listConnections(db, 'owner')).toMatchObject([{ id: 'older', isDefault: 1 }, { id: 'newer', isDefault: 0 }]);
      expect(await listConnections(db, 'other')).toMatchObject([{ id: 'foreign', isDefault: 0 }]);

      await removeConnection(db, 'owner', 'newer');
      await expect(removeConnection(db, 'owner', 'older')).resolves.toBe(true);
      await expect(listConnections(db, 'owner')).resolves.toEqual([]);
    } finally { await dispose(); }
  });

  function resolverDb(defaults: Array<{ id: string }>, explicit?: { id: string }) {
    return {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async all<T>() {
                return { results: defaults.map((row) => ({ id: row.id, userId: values[0], friendlyName: row.id, instanceId: row.id, encryptedToken: 'encrypted' })) as T[] };
              },
              async first<T>() {
                if (sql.includes('WHERE id = ?1')) return explicit as T | undefined;
                return undefined;
              },
            };
          },
        };
      },
    };
  }

  it('resolves the explicit connection before the default', async () => {
    const db = resolverDb([{ id: 'default' }], { id: 'explicit' });
    await expect(resolveConnection(db as unknown as D1Database, 'user-1', 'explicit')).resolves.toMatchObject({ id: 'explicit' });
  });

  it('resolves the only default when connectionId is omitted', async () => {
    const db = resolverDb([{ id: 'default' }]);
    await expect(resolveConnection(db as unknown as D1Database, 'user-1')).resolves.toMatchObject({ id: 'default' });
  });

  it('rejects omitted connectionId when there is no default', async () => {
    const db = resolverDb([]);
    await expect(resolveConnection(db as unknown as D1Database, 'user-1')).rejects.toThrow('No default connection configured. Configure a default connection or pass a connection identifier');
  });

  it('rejects ambiguous defaults', async () => {
    const db = resolverDb([{ id: 'one' }, { id: 'two' }]);
    await expect(resolveConnection(db as unknown as D1Database, 'user-1')).rejects.toThrow('Multiple default connections configured');
  });

});

describe('JSON:API webhook validation', () => {
  const db = {prepare() {return {bind() {return {async first() {return {id:'connection-1',userId:'user-1',instanceId:'instance-1'};}};}};}};
  it('resolves the webhook connection and validates JSON:API without archiving payloads',async()=>{
    const data={type:'message',id:'message-1'};
    await expect(validateWebhookEvent(db as unknown as D1Database,'webhook-secret',{jsonapi:{version:'1.1'},meta:{event:'Message',instanceId:'instance-1'},data})).resolves.toMatchObject({accepted:true,connection:{id:'connection-1',userId:'user-1'},eventName:'Message',resources:[data]});
  });
  it('accepts collections and rejects legacy envelopes, invalid resources and instance mismatches',async()=>{
    await expect(validateWebhookEvent(db as unknown as D1Database,'webhook-secret',{jsonapi:{version:'1.1'},meta:{event:'HistorySync',instanceId:'instance-1'},data:[]})).resolves.toMatchObject({accepted:true});
    await expect(validateWebhookEvent(db as unknown as D1Database,'webhook-secret',{event:'Message',data:[]})).resolves.toMatchObject({accepted:false,status:400});
    await expect(validateWebhookEvent(db as unknown as D1Database,'webhook-secret',{jsonapi:{version:'1.1'},meta:{event:'Message',instanceId:'other'},data:[]})).resolves.toMatchObject({accepted:false,status:400,error:'Webhook instance mismatch'});
    await expect(validateWebhookEvent(db as unknown as D1Database,'webhook-secret',{jsonapi:{version:'1.1'},meta:{event:'Message',instanceId:'instance-1'},data:{}})).resolves.toMatchObject({accepted:false,status:400});
  });
});
