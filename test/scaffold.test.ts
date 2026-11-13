import { describe, expect, it } from 'vitest';
import { app, MCP_PROTOCOL_VERSION } from '../src/index';
import { evolutionState } from '../src/lib/connection-status';
import { encryptToken, decryptToken } from '../src/lib/crypto';
import { EvolutionGoClient } from '../src/lib/evolution';
import { createTestD1 } from './helpers/local-d1';

const env = {
  DB: {} as D1Database,
  EVOLUTION_BASE_URL: 'https://evolution.invalid',
  TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  CLERK_PUBLISHABLE_KEY: 'pk_live_' + Buffer.from('clerk.fixture.invalid$').toString('base64'),
  CLERK_SECRET_KEY: 'sk_live_synthetic',
  MCP_PUBLIC_URL: 'https://mcp.invalid',
} as any;

describe('worker scaffold', () => {
  it('serves health with the current SDK protocol revision', async () => {
    const response = await app.request('/healthz', {}, env);
    expect(response.status).toBe(200);
    expect((await response.json() as { protocol: string }).protocol).toBe(MCP_PROTOCOL_VERSION);
  });

  it('maps JSON:API connection resources from Evolution Go status responses', () => {
    const connected = {
      jsonapi: { version: '1.1' },
      data: {
        type: 'connection',
        id: 'instance-1',
        attributes: { connected: true, loggedIn: true, phone: '5511999999999@s.whatsapp.net' },
      },
    };
    expect(evolutionState(connected)).toBe('connected');
    expect(evolutionState({ ...connected, data: { ...connected.data, attributes: { connected: false, loggedIn: false } } })).toBe('qr');
    expect(evolutionState({ ...connected, data: { ...connected.data, attributes: { connected: false, loggedIn: true } } })).toBe('offline');
  });

  it('rejects non JSON:API status payloads instead of applying a legacy fallback', () => {
    expect(evolutionState({ message: 'success', data: { connected: true, loggedIn: true } })).toBe('error');
    expect(evolutionState({ jsonapi: { version: '1.0' }, data: { type: 'connection', attributes: { connected: true, loggedIn: true } } })).toBe('error');
  });

  it('protects MCP and does not expose legacy /sse', async () => {
    const response = await app.request('/mcp', {}, env);
    expect(response.status).toBe(401);
    expect((await app.request('/sse', {}, env)).status).toBe(404);
    const local = await app.request('/mcp', { headers: { 'Cf-Access-Jwt-Assertion': 'fake-access-assertion' } }, { ...env, ENVIRONMENT: 'local', LOCAL_DEV_USER_EMAIL: 'dev@example.test', LOCAL_INSTANCE_TOKEN: 'fixture-secret' });
    expect(local.status).toBe(401);
  });

  it('protects authorization management on the UI and API surfaces', async () => {
    for (const path of ['/connections/authorizations', '/api/authorizations']) {
      const response = await app.request('https://mcp.invalid' + path, {}, env);
      expect(response.status).toBe(401);
      expect((await response.json() as { error: string }).error).toContain('Entre no WaPilot');
    }
  });

  it('routes the legacy admin URL through the authenticated connections surface', async () => {
    const response = await app.request('/admin/evolution', {}, env);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/connections?provision=1');
  });

  it('allows the synthetic UI identity only in the local environment', async () => {
    const database = await createTestD1();
    try {
      const response = await app.request('/connections', {}, { ...env, DB: database.db, ENVIRONMENT: 'local', LOCAL_DEV_USER_EMAIL: 'dev@example.test' });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('dev@example.test');
    } finally { await database.dispose(); }
    expect((await app.request('https://mcp.invalid/connections', {}, env)).status).toBe(401);
  });

  it('encrypts and decrypts instance tokens with authenticated encryption', async () => {
    const encrypted = await encryptToken('instance-secret', env.TOKEN_ENCRYPTION_KEY);
    expect(encrypted).not.toContain('instance-secret');
    await expect(decryptToken(encrypted, env.TOKEN_ENCRYPTION_KEY)).resolves.toBe('instance-secret');
    await expect(decryptToken(`${encrypted}x`, env.TOKEN_ENCRYPTION_KEY)).rejects.toThrow();
  });

  it('sends per-instance credentials as headers and normalizes cursor pages', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid/', instanceId: 'instance-1', instanceToken: 'secret', globalApiKey: 'global', fetcher: async (request, init) => {
      seen = { url: String(request), init: init as RequestInit };
      return new Response(JSON.stringify({ jsonapi: { version: '1.1' }, data: [{ type: 'chat', id: '1', attributes: { fullName: 'Alice' } }] }), { status: 200, headers: { 'content-type': 'application/vnd.api+json' } });
    } });
    const page = await client.searchContacts('Alice');
    expect(page.items).toEqual([{ id: '1', jid: '1', name: 'Alice' }]);
    expect(page.nextCursor).toBeUndefined();
    expect(page.hasMore).toBe(false);
    expect(new Headers(seen?.init.headers).get('apikey')).toBe('secret');
    expect(new Headers(seen?.init.headers).get('Authorization')).toBeNull();
    expect(seen?.url).not.toContain('secret');
  });
});
