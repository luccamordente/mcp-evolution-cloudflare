import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import { adminPage } from '../src/ui/admin';

const env = {
  DB: {} as D1Database,
  EVOLUTION_BASE_URL: 'https://evolution.invalid',
  TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  CLERK_PUBLISHABLE_KEY: 'pk_live_' + Buffer.from('clerk.fixture.invalid$').toString('base64'),
  CLERK_SECRET_KEY: 'sk_live_synthetic',
  MCP_PUBLIC_URL: 'https://mcp.invalid',
} as any;

const dashboardDb = {
  prepare() {
    return {
      first: async () => ({ id: 'local-user', email: 'luccamordente@gmail.com' }),
      all: async () => ({ results: [] }),
      bind(...values: unknown[]) {
        return {
          first: async () => ({ id: 'local-user', email: values[0] }),
          all: async () => ({ results: [] }),
          run: async () => ({ success: true }),
        };
      },
    };
  },
} as unknown as D1Database;

describe('admin operational page', () => {
  it('filters an operational snapshot locally and fetches only on load and manual refresh', async () => {
    const users = [
      { email: 'healthy@example.test', connections: [{ friendlyName: 'Healthy', live: { state: 'connected' } }] },
      {
        email: 'offline@example.test', authorizations: { status: 'unavailable' },
        connections: [{ friendlyName: 'Offline', live: { state: 'offline' }, activityStatus: 'unavailable' }],
      },
    ];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ users }));
    const dom = new JSDOM(adminPage(), {
      url: 'https://mcp.invalid/admin',
      runScripts: 'dangerously',
      beforeParse(window) { window.fetch = fetcher as typeof window.fetch; },
    });
    try {
      const { document, Event } = dom.window;
      const list = document.querySelector('#users-list')!;
      await vi.waitFor(() => expect(list.textContent).toContain('healthy@example.test'));
      expect(list.textContent).toContain('offline@example.test');
      expect(list.textContent).toContain('OAuth indisponível');
      expect(list.textContent).toContain('Auditoria indisponível');
      expect(list.querySelector('button, form')).toBeNull();

      const search = document.querySelector<HTMLInputElement>('#admin-search')!;
      search.value = 'healthy';
      search.dispatchEvent(new Event('input'));
      expect(list.textContent).toContain('healthy@example.test');
      expect(list.textContent).not.toContain('offline@example.test');
      search.value = '';
      search.dispatchEvent(new Event('input'));
      const attention = document.querySelector('select')!;
      attention.value = 'attention';
      attention.dispatchEvent(new Event('change'));
      expect(list.textContent).toContain('offline@example.test');
      expect(list.textContent).not.toContain('healthy@example.test');
      expect(fetcher).toHaveBeenCalledTimes(1);
      const refresh = document.querySelector<HTMLButtonElement>('#refresh-snapshot')!;
      refresh.click();
      await vi.waitFor(() => expect(refresh.disabled).toBe(false));
      expect(fetcher.mock.calls.map(([path, init]) => [path, init?.method ?? 'GET'])).toEqual([
        ['/admin/data', 'GET'], ['/admin/data', 'GET'],
      ]);
    } finally { dom.window.close(); }
  });

  it('protects both administrative surfaces before loading or producing a snapshot', async () => {
    const page = await app.request('https://mcp.invalid/admin', {}, env);
    const data = await app.request('https://mcp.invalid/admin/data', {}, env);
    const bearer = await app.request('https://mcp.invalid/admin', { headers: { authorization: 'Bearer access-token' } }, env);

    expect(page.status).toBe(401);
    expect(data.status).toBe(401);
    expect(bearer.status).toBe(401);
    expect((await data.json() as { error: string }).error).toContain('Entre no WaPilot');
  });

  it('uses the dashboard identity and applies the independent admin allowlist', async () => {
    const local = { ...env, DB: dashboardDb, ENVIRONMENT: 'local' };
    const adminStatus = async (email: string, allowed?: string) => {
      const response = await app.request('https://mcp.invalid/admin', {}, { ...local, LOCAL_DEV_USER_EMAIL: email, ADMIN_EMAILS: allowed });
      return response.status;
    };
    expect((await app.request('/connections', {}, { ...local, LOCAL_DEV_USER_EMAIL: 'other@example.test' })).status).toBe(200);
    expect(await adminStatus('LUCCAMORDENTE@GMAIL.COM')).toBe(200);
    expect(await adminStatus('heitorsalazar@gmail.com')).toBe(200);
    expect(await adminStatus('other@example.test')).toBe(403);
    expect(await adminStatus('other@example.test', ' OTHER@EXAMPLE.TEST ')).toBe(200);
    expect(await adminStatus('luccamordente@gmail.com', 'other@example.test')).toBe(403);
  });
});
