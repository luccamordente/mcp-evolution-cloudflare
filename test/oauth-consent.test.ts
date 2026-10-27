import { describe, expect, it, vi } from 'vitest';
import { getOAuthApi } from '@cloudflare/workers-oauth-provider';
import { createOAuthProvider, oauthOptions } from '../src/lib/oauth';
import type { Env } from '../src/types';

vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }));

const base = 'https://mcp.invalid';
const allScopes = ['mcp:read', 'mcp:write', 'offline_access'];

async function setup() {
  const values = new Map<string, string>();
  const env = {
    ENVIRONMENT: 'local',
    LOCAL_DEV_USER_EMAIL: 'dev@example.test',
    CONSENT_SECRET: 'test-consent-secret-with-at-least-32-characters',
    OAUTH_KV: {
      async get(key: string, options?: { type: string }) {
        const value = values.get(key);
        return value === undefined ? null : options?.type === 'json' ? JSON.parse(value) : value;
      },
      async put(key: string, value: string) { values.set(key, value); },
      async delete(key: string) { values.delete(key); },
    },
  } as unknown as Env;
  const provider = createOAuthProvider(base);
  const fetch = (path: string, init?: RequestInit) => provider.fetch(
    new Request(`${base}${path}`, init), env, { waitUntil: vi.fn() } as unknown as ExecutionContext,
  );
  const oauth = getOAuthApi(oauthOptions(base), env);
  const client = await oauth.createClient({
    clientName: 'Test client',
    redirectUris: ['https://client.invalid/callback'],
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
  });
  const verifier = 'a'.repeat(43);
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
  const query = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUris[0],
    response_type: 'code',
    resource: `${base}/mcp`,
    scope: 'mcp:read',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const consent = await fetch(`/authorize?${query}`);
  expect(consent.status).toBe(200);
  const html = await consent.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)![1];
  const cookie = consent.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const decide = (decision: string, binding = cookie) => fetch('/authorize', {
    method: 'POST',
    headers: { Cookie: binding },
    body: new URLSearchParams({ handle, decision }),
  });
  return { fetch, client, verifier, html, decide };
}

describe('initial OAuth consent', () => {
  it('advertises read and write in discovery and the initial challenge', async () => {
    const { fetch } = await setup();
    const metadata = await fetch('/.well-known/oauth-protected-resource/mcp');
    expect(await metadata.json()).toMatchObject({ scopes_supported: ['mcp:read', 'mcp:write'] });
    const challenge = await fetch('/mcp');
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get('WWW-Authenticate')).toContain('scope="mcp:read mcp:write"');
  });

  it('shows and grants all permissions even when the client initially requests only read', async () => {
    const { fetch, client, verifier, html, decide } = await setup();
    expect(html).toContain('Consultar seus dados do WhatsApp');
    expect(html).toContain('Enviar mensagens e executar ações autorizadas');
    expect(html).toContain('Continuar conectado quando você não estiver usando o app');

    const approved = await decide('allow');
    expect(approved.status).toBe(302);
    const code = new URL(approved.headers.get('Location')!).searchParams.get('code')!;
    const token = await fetch('/oauth/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client.clientId,
        redirect_uri: client.redirectUris[0],
        code,
        code_verifier: verifier,
        resource: `${base}/mcp`,
      }),
    });
    expect(token.status).toBe(200);
    expect(await token.json()).toMatchObject({ scope: allScopes.join(' '), refresh_token: expect.any(String) });
    expect((await decide('allow')).status).toBe(400);
  });

  it('requires the browser binding before granting permissions', async () => {
    const { decide } = await setup();
    expect((await decide('allow', '')).status).toBe(400);
  });

  it('lets the user deny all permissions', async () => {
    const { decide } = await setup();
    const denied = await decide('deny');
    expect(denied.status).toBe(302);
    expect(new URL(denied.headers.get('Location')!).searchParams.get('error')).toBe('access_denied');
  });
});
