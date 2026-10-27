import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { connectionsPage } from '../src/ui/connections';

const env = { DB: {} } as never;

describe('dashboard /connections/api alias', () => {
  it('dispatches to the /api handler with the same Access verification', async () => {
    const direct = await app.request('/api/connections/abc/status', {}, env);
    const alias = await app.request('/connections/api/connections/abc/status', {}, env);
    expect(alias.status).toBe(direct.status);
    expect(await alias.json()).toEqual(await direct.json());
    expect(alias.status).not.toBe(404);
  });

  it('protects the full-activity route', async () => {
    const response = await app.request('/connections/activity/abc', {}, env);
    expect([401, 503]).toContain(response.status);
  });
});

describe('connections UI session and activity handling', () => {
  const html = connectionsPage({ id: 'u', email: 'a@example.com', claims: {} } as never);
  it('routes /api calls through the /connections Access app and detects Access redirects', () => {
    expect(html).toContain("'/connections' + path");
    expect(html).toContain("redirect:'manual'");
    expect(html).toContain("opaqueredirect");
    expect(html).toContain('Sua sessão expirou. Recarregue a página e entre de novo.');
    expect(html).toContain('window.location.reload()');
  });
  it('wires "Ver tudo" to load the full activity list', () => {
    expect(html).toContain("target.dataset.activity");
    expect(html).toContain("'/connections/activity/'");
    expect(html).toContain('Ver menos');
  });
});
