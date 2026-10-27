import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import { removeConnection } from '../src/lib/db';
import { connectionsPage } from '../src/ui/connections';

function fakeDb(rows: Array<{ id: string; user_id: string; is_default: number; created_at: string }>) {
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) { args = values; return stmt; },
        async first() {
          if (sql.startsWith('SELECT id, is_default')) { const r = rows.find((x) => x.id === args[0] && x.user_id === args[1]); return r ? { id: r.id, isDefault: r.is_default } : null; }
          if (sql.startsWith('SELECT id FROM')) { const r = rows.filter((x) => x.user_id === args[0] && x.id !== args[1]).sort((a, b) => a.created_at.localeCompare(b.created_at))[0]; return r ? { id: r.id } : null; }
          return null;
        },
        run: async () => {
          if (sql.startsWith('DELETE')) { const i = rows.findIndex((x) => x.id === args[0] && x.user_id === args[1]); if (i >= 0) rows.splice(i, 1); }
          if (sql.startsWith('UPDATE')) { const r = rows.find((x) => x.id === args[0] && x.user_id === args[1]); if (r) r.is_default = 1; }
          return {};
        },
      };
      return stmt;
    },
    async batch(stmts: Array<{ run: () => Promise<unknown> }>) { for (const s of stmts) await s.run(); return []; },
  };
  return db as never;
}

describe('removeConnection', () => {
  it('refuses another user\'s row', async () => {
    const rows = [{ id: 'a', user_id: 'u1', is_default: 1, created_at: '1' }];
    expect(await removeConnection(fakeDb(rows), 'u2', 'a')).toBe(false);
    expect(rows).toHaveLength(1);
  });
  it('promotes the oldest remaining row when the default is removed', async () => {
    const rows = [{ id: 'a', user_id: 'u1', is_default: 1, created_at: '1' }, { id: 'c', user_id: 'u1', is_default: 0, created_at: '3' }, { id: 'b', user_id: 'u1', is_default: 0, created_at: '2' }, { id: 'x', user_id: 'u2', is_default: 0, created_at: '0' }];
    expect(await removeConnection(fakeDb(rows), 'u1', 'a')).toBe(true);
    expect(rows.find((r) => r.id === 'b')?.is_default).toBe(1);
    expect(rows.find((r) => r.id === 'x')?.is_default).toBe(0);
  });
  it('leaves no default when the last row is removed', async () => {
    const rows = [{ id: 'a', user_id: 'u1', is_default: 1, created_at: '1' }];
    expect(await removeConnection(fakeDb(rows), 'u1', 'a')).toBe(true);
    expect(rows).toHaveLength(0);
  });
});

describe('remove route', () => {
  it('is reachable through the /connections/api alias and requires Access', async () => {
    const res = await app.request('/connections/api/connections/abc', { method: 'DELETE' }, { DB: {} } as never);
    expect([401, 503]).toContain(res.status);
  });
});

describe('connections UI retest fixes', () => {
  const html = connectionsPage({ id: 'u', email: 'a@example.com', claims: {} } as never);
  it('offers Remover número with a confirm dialog', () => {
    expect(html).toContain('Remover número');
    expect(html).toContain('window.confirm(');
    expect(html).toContain("method:'DELETE'");
  });
  it('does not switch selection when provisioning starts', () => {
    const provision = html.slice(html.indexOf('const provision = async'), html.indexOf('const renewQr'));
    expect(provision).not.toContain('state.activeId = connection.id');
    expect(provision).not.toContain("localStorage.setItem('wapilot.activeConnection'");
  });
  it('shows status and reconnect for error connections instead of onboarding', () => {
    expect(html).toContain("connection.state === 'error' || connection.state === 'offline') { showDashboard();");
    expect(html).toContain('Reconectar →');
  });
  it('really hides the QR placeholder', () => {
    expect(html).toContain('.qr-placeholder[hidden]');
  });
});
