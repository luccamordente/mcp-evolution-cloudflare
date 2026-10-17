import { describe, expect, it } from 'vitest';
import { app, MCP_PROTOCOL_VERSION } from '../src/index';
import { evolutionState } from '../src/lib/connection-status';
import { encryptToken, decryptToken } from '../src/lib/crypto';
import { EvolutionGoClient } from '../src/lib/evolution';
import { accessAudiences, authenticateAccessRequest } from '../src/lib/auth';

const env = {
  DB: {} as D1Database,
  EVOLUTION_BASE_URL: 'https://evolution.invalid',
  TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  ACCESS_JWKS_URL: 'https://access.invalid/certs',
  ACCESS_ISSUER: 'https://access.invalid',
  ACCESS_AUDIENCE: 'aud',
  ALLOWED_EMAILS: 'luccamordente@gmail.com,heitorsalazar@gmail.com',
} as any;

describe('worker scaffold', () => {
  it('accepts comma-separated Cloudflare Access audiences', () => {
    expect(accessAudiences({ ACCESS_AUDIENCE: 'authorize-aud, connections-aud, api-aud' })).toEqual([
      'authorize-aud',
      'connections-aud',
      'api-aud',
    ]);
  });

  it('accepts comma-separated Cloudflare Access audiences', () => {
    expect(accessAudiences({ ACCESS_AUDIENCE: 'authorize-aud, connections-aud, api-aud' })).toEqual([
      'authorize-aud',
      'connections-aud',
      'api-aud',
    ]);
  });

  it('serves health with the current SDK protocol revision', async () => {
    const response = await app.request('/healthz', {}, env);
    expect(response.status).toBe(200);
    expect((await response.json() as { protocol: string }).protocol).toBe(MCP_PROTOCOL_VERSION);
  });

  it('maps Evolution Go connected/loggedIn status booleans', () => {
    expect(evolutionState({ message: 'success', data: { connected: true, loggedIn: true, myJid: '5511999999999@s.whatsapp.net' } })).toBe('connected');
    expect(evolutionState({ message: 'success', data: { Connected: true, LoggedIn: true, MyJid: '5511999999999@s.whatsapp.net' } })).toBe('connected');
    expect(evolutionState({ message: 'success', data: { connected: false, loggedIn: false } })).toBe('qr');
    expect(evolutionState({ message: 'success', data: { connected: false, loggedIn: true } })).toBe('offline');
  });

  it('protects MCP and does not expose legacy /sse', async () => {
    const response = await app.request('/mcp', {}, env);
    expect(response.status).toBe(401);
    expect((await app.request('/sse', {}, env)).status).toBe(404);
  });

  it('protects authorization management on the UI and API surfaces', async () => {
    for (const path of ['/connections/authorizations', '/api/authorizations']) {
      const response = await app.request(path, {}, env);
      expect(response.status).toBe(401);
      expect((await response.json() as { error: string }).error).toContain('Cloudflare Access');
    }
  });

  it('allows the synthetic UI identity only in the local environment', async () => {
    await expect(authenticateAccessRequest(new Request('http://localhost/connections'), {
      ...env,
      ENVIRONMENT: 'local',
      LOCAL_DEV_USER_EMAIL: 'dev@example.test',
    } as any)).resolves.toMatchObject({ id: 'local:dev@example.test', email: 'dev@example.test' });
    await expect(authenticateAccessRequest(new Request('http://localhost/connections'), env)).rejects.toMatchObject({ status: 401 });
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
      return new Response(JSON.stringify({ items: [{ jid: '1@s.whatsapp.net', name: 'Alice' }], next_cursor: 'next' }), { status: 200, headers: { 'content-type': 'application/json' } });
    } });
    const page = await client.searchContacts('Alice');
    expect(page.nextCursor).toBe('next');
    expect(page.hasMore).toBe(true);
    expect(new Headers(seen?.init.headers).get('apikey')).toBe('secret');
    expect(new Headers(seen?.init.headers).get('Authorization')).toBeNull();
    expect(seen?.url).not.toContain('secret');
  });
});
