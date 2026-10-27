import { describe, expect, it, vi } from 'vitest';
import { removeUserConnection } from '../src/index';
import { connectionsPage } from '../src/ui/connections';

type Row = { id: string; user_id: string; instance_id: string; is_default: number; created_at: string };
function env(rows: Row[], auditInserts: unknown[] = []) {
  const DB = {
    prepare(sql: string) {
      let a: unknown[] = [];
      const st = {
        bind(...v: unknown[]) { a = v; return st; },
        async first() {
          if (sql.startsWith('SELECT id, user_id')) { const r = rows.find((x) => x.id === a[0] && x.user_id === a[1]); return r ? { id: r.id, userId: r.user_id, instanceId: r.instance_id } : null; }
          if (sql.startsWith('SELECT id, is_default')) { const r = rows.find((x) => x.id === a[0] && x.user_id === a[1]); return r ? { id: r.id, isDefault: r.is_default } : null; }
          if (sql.startsWith('SELECT id FROM')) { const r = rows.filter((x) => x.user_id === a[0] && x.id !== a[1])[0]; return r ? { id: r.id } : null; }
          return null;
        },
        async all() { return { results: rows.filter((x) => x.user_id === a[0]).map((x) => ({ id: x.id, isDefault: x.is_default })) }; },
        async run() {
          if (sql.startsWith('DELETE')) { const i = rows.findIndex((x) => x.id === a[0] && x.user_id === a[1]); if (i >= 0) rows.splice(i, 1); }
          if (sql.startsWith('INSERT INTO audit_log')) {
            // Mirror the production FK: connection_id must reference an existing row.
            if (a[2] !== null && !rows.some((x) => x.id === a[2])) throw new Error('FOREIGN KEY constraint failed');
            auditInserts.push(a);
          }
          return {};
        },
      };
      return st;
    },
    async batch(s: Array<{ run: () => Promise<unknown> }>) { for (const x of s) await x.run(); return []; },
  };
  return { DB } as never;
}
const rowsFor = (): Row[] => [
  { id: 'def', user_id: 'u1', instance_id: 'i-def', is_default: 1, created_at: '1' },
  { id: 'tmp', user_id: 'u1', instance_id: 'i-tmp', is_default: 0, created_at: '2' },
];

describe('removeUserConnection', () => {
  it('returns 200 with instanceDeleted true and audits without a dangling FK', async () => {
    const rows = rowsFor(); const audits: unknown[] = [];
    const admin = { deleteInstance: vi.fn().mockResolvedValue(undefined) };
    const [body, status] = await removeUserConnection(env(rows, audits), 'u1', 'tmp', admin as never);
    expect(status).toBe(200);
    expect(body).toEqual({ removed: true, id: 'tmp', instanceDeleted: true });
    expect(admin.deleteInstance).toHaveBeenCalledWith('i-tmp');
    expect(rows.map((r) => r.id)).toEqual(['def']);
    expect(audits).toHaveLength(1);
  });
  it('still returns 200 with instanceDeleted false when Evolution fails', async () => {
    const rows = rowsFor();
    const [body, status] = await removeUserConnection(env(rows), 'u1', 'tmp', { deleteInstance: vi.fn().mockRejectedValue(new Error('boom')) } as never);
    expect(status).toBe(200);
    expect(body).toMatchObject({ instanceDeleted: false });
  });
  it('refuses the default number with 409 and deletes nothing', async () => {
    const rows = rowsFor(); const admin = { deleteInstance: vi.fn() };
    const [, status] = await removeUserConnection(env(rows), 'u1', 'def', admin as never);
    expect(status).toBe(409);
    expect(admin.deleteInstance).not.toHaveBeenCalled();
    expect(rows).toHaveLength(2);
  });
  it('refuses another user\'s row with 404', async () => {
    const rows = rowsFor(); const admin = { deleteInstance: vi.fn() };
    const [, status] = await removeUserConnection(env(rows), 'u2', 'tmp', admin as never);
    expect(status).toBe(404);
    expect(admin.deleteInstance).not.toHaveBeenCalled();
    expect(rows).toHaveLength(2);
  });
});

describe('remove UI', () => {
  const html = connectionsPage({ id: 'u', email: 'a@example.com', claims: {} } as never);
  it('hides Remover on the default number and surfaces errors', () => {
    expect(html).toContain("(connection.isDefault ? '' : '<button class=\"secondary danger\"");
    expect(html).toContain('Não foi possível remover o número: ');
    expect(html).toContain('state.connections = state.connections.filter((item) => item.id !== id)');
  });
});
