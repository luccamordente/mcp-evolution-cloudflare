import { describe, expect, it } from 'vitest';
import { removeConnection, resolveConnection } from '../src/lib/db';

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
                return { results: defaults.map((row) => ({ id: row.id, userId: values[0], friendlyName: row.id, instanceId: row.id, encryptedToken: 'encrypted', status: 'active', connectionState: 'connected' })) as T[] };
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
