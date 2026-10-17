import { describe, expect, it } from 'vitest';
import { ingestWebhookEvent, removeConnection, resolveConnection } from '../src/lib/db';

type ConnectionRow = { id: string; userId: string; isDefault: number; createdAt: string };

function fakeDb(initial: ConnectionRow[]) {
  const rows = [...initial];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('SELECT id, is_default')) {
                const [id, userId] = values as [string, string];
                return rows.find((row) => row.id === id && row.userId === userId) as T | undefined;
              }
              if (sql.includes('SELECT id FROM whatsapp_connections')) {
                const [userId, excludedId] = values as [string, string];
                return rows
                  .filter((row) => row.userId === userId && row.id !== excludedId)
                  .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] as T | undefined;
              }
              return undefined;
            },
            async run() {
              if (sql.startsWith('DELETE FROM whatsapp_connections')) {
                const [id, userId] = values as [string, string];
                const index = rows.findIndex((row) => row.id === id && row.userId === userId);
                if (index >= 0) rows.splice(index, 1);
                return { meta: { changes: index >= 0 ? 1 : 0 } };
              }
              if (sql.startsWith('UPDATE whatsapp_connections SET is_default = 1')) {
                const [id, userId] = values as [string, string];
                const row = rows.find((candidate) => candidate.id === id && candidate.userId === userId);
                if (row) row.isDefault = 1;
                return { meta: { changes: row ? 1 : 0 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      for (const statement of statements) await statement.run();
    },
    rows,
  };
  return db;
}

describe('connection defaults', () => {
  it('promotes the oldest remaining connection when the default is deleted', async () => {
    const db = fakeDb([
      { id: 'default', userId: 'user-1', isDefault: 1, createdAt: '2026-10-15 10:00:00' },
      { id: 'remaining', userId: 'user-1', isDefault: 0, createdAt: '2026-10-15 11:00:00' },
    ]);

    await expect(removeConnection(db as unknown as D1Database, 'user-1', 'default')).resolves.toBe(true);
    expect(db.rows).toEqual([
      { id: 'remaining', userId: 'user-1', isDefault: 1, createdAt: '2026-10-15 11:00:00' },
    ]);
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

describe('JSON:API webhook ingestion', () => {
  it('persists message resources and redacts the webhook instance token', async () => {
    const seen: Array<{ values: unknown[]; document: Record<string, unknown> }> = [];
    let lookupSql = '';
    const db = {
      prepare(sql: string) {
        lookupSql = sql;
        return {
          bind(...values: unknown[]) {
            return {
              async first<T>() {
                if (sql.includes('webhook_secret_hash')) return { id: 'connection-1', instanceId: 'instance-1' } as T;
                return undefined;
              },
              async run() {
                if (sql.startsWith('INSERT OR IGNORE INTO webhook_events')) {
                  const json = JSON.parse(String(values[5])) as Record<string, unknown>;
                  seen.push({ values, document: json });
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              },
            };
          },
        };
      },
      async batch(statements: Array<{ run: () => Promise<{ meta?: { changes?: number } }> }>) {
        return Promise.all(statements.map((statement) => statement.run()));
      },
    };

    const result = await ingestWebhookEvent(db as unknown as D1Database, 'webhook-secret', {
      jsonapi: { version: '1.1' },
      meta: { event: 'Message', instanceId: 'instance-1', instanceToken: 'do-not-store', instanceName: 'lucca' },
      data: {
        type: 'message',
        id: 'message-1',
        attributes: { at: 1792164209000, encodingFormat: 'text/plain', body: { text: 'Olá' } },
        relationships: { author: { data: { type: 'chat', id: '551142000028' } } },
        meta: { chat: '551142000028', fromMe: false },
      },
    });

    expect(result).toEqual({ accepted: true, status: 202 });
    expect(seen).toHaveLength(1);
    expect(seen[0].values.slice(2, 5)).toEqual(['Message', 'message-1', '551142000028']);
    expect(seen[0].document).toMatchObject({
      jsonapi: { version: '1.1' },
      data: { type: 'message', id: 'message-1' },
      meta: { event: 'Message', instanceId: 'instance-1', instanceName: 'lucca' },
    });
    expect(JSON.stringify(seen[0].document)).not.toContain('do-not-store');
    expect(lookupSql).not.toContain("status = 'active'");
  });

  it('accepts a JSON:API collection for history sync', async () => {
    let batchSize = 0;
    const db = {
      prepare(sql: string) {
        return {
          bind(..._values: unknown[]) {
            return {
              async first<T>() { return (sql.includes('webhook_secret_hash') ? { id: 'connection-1', instanceId: 'instance-1' } : undefined) as T | undefined; },
              async run() { return { meta: { changes: 1 } }; },
            };
          },
        };
      },
      async batch(statements: Array<{ run: () => Promise<unknown> }>) { batchSize = statements.length; return statements.map(() => ({ meta: { changes: 1 } })); },
    };
    await expect(ingestWebhookEvent(db as unknown as D1Database, 'webhook-secret', {
      jsonapi: { version: '1.1' },
      meta: { event: 'HistorySync', instanceId: 'instance-1' },
      data: [
        { type: 'message', id: 'message-1', attributes: { at: 1, encodingFormat: 'text/plain', body: { text: 'a' } }, meta: { chat: 'chat-1' } },
        { type: 'message', id: 'message-2', attributes: { at: 2, encodingFormat: 'text/plain', body: { text: 'b' } }, meta: { chat: 'chat-1' } },
      ],
    })).resolves.toEqual({ accepted: true, status: 202 });
    expect(batchSize).toBe(2);
  });

  it('rejects legacy envelopes and mismatched instance metadata', async () => {
    const db = {
      prepare(sql: string) {
        return { bind(..._values: unknown[]) { return { async first<T>() { return (sql.includes('webhook_secret_hash') ? { id: 'connection-1', instanceId: 'instance-1' } : undefined) as T | undefined; } }; } };
      },
    };
    await expect(ingestWebhookEvent(db as unknown as D1Database, 'webhook-secret', { event: 'Message', data: [] })).resolves.toMatchObject({ accepted: false, status: 400 });
    await expect(ingestWebhookEvent(db as unknown as D1Database, 'webhook-secret', { jsonapi: { version: '1.1' }, meta: { event: 'Message', instanceId: 'other' }, data: [] })).resolves.toMatchObject({ accepted: false, status: 400, error: 'Webhook instance mismatch' });
  });
});
