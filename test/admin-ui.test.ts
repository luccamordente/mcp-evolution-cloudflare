import { describe, expect, it } from 'vitest';
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
  it('renders an explicitly read-only administrative workspace', () => {
    const html = adminPage();

    expect(html).toContain('WaPilot · Admin');
    expect(html).toContain('Modo administrativo');
    expect(html).toContain('Somente leitura');
    expect(html).toContain('/admin/data');
    expect(html).toContain('admin-search');
    expect(html).toContain('attention-filter');
    expect(html).toContain('refresh-snapshot');
    expect(html).toContain('snapshot-generated-at');
    expect(html).toContain('Nenhum usuário encontrado');
    expect(html).toContain('OAuth indisponível');
    expect(html).toContain('Auditoria indisponível');
    expect(html).toContain('Nenhuma autorização ativa');
    expect(html).toContain('Atualizar snapshot');
    expect(html).toContain('Estado live:');
    expect(html).not.toContain('>Cadastro: ');
    expect(html).not.toContain('/api/connections/provision');
    expect(html).not.toContain('revoke');
    expect(html).not.toContain('method="POST"');
  });

  it('keeps the client to one snapshot request per manual load', () => {
    const html = adminPage();

    expect(html.match(/fetch\('\/admin\/data'/g)).toHaveLength(1);
    expect(html).toContain("refreshButton.addEventListener('click', () => loadSnapshot(true))");
    expect(html).toContain("searchInput.addEventListener('input'");
    expect(html).toContain("attentionFilter.addEventListener('change'");
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

  it('gives both operational administrators the same browser-session page and rejects others', async () => {
    for (const email of ['luccamordente@gmail.com', 'heitorsalazar@gmail.com']) {
      const response = await app.request('https://mcp.invalid/admin', {}, { ...env, DB: dashboardDb, ENVIRONMENT: 'local', LOCAL_DEV_USER_EMAIL: email });
      expect(response.status).toBe(200);
    }
    const outsider = await app.request('https://mcp.invalid/admin', {}, { ...env, DB: dashboardDb, ENVIRONMENT: 'local', LOCAL_DEV_USER_EMAIL: 'other@example.com' });
    expect(outsider.status).toBe(403);
  });

  it('uses the dashboard identity for both /connections and /admin', async () => {
    const sharedAccessEnv = {
      ...env,
      DB: dashboardDb,
      ENVIRONMENT: 'local',
      LOCAL_DEV_USER_EMAIL: 'luccamordente@gmail.com',
    };

    const dashboard = await app.request('/connections', {}, sharedAccessEnv);
    const admin = await app.request('https://mcp.invalid/admin', {}, sharedAccessEnv);

    expect(dashboard.status).toBe(200);
    expect(admin.status).toBe(200);
  });
});
