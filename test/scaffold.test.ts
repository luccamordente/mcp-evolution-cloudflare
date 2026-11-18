import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { evolutionState } from '../src/lib/connection-status';
import { encryptToken, decryptToken } from '../src/lib/crypto';
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
    expect(await response.json()).toMatchObject({ ok: true, protocol: '2026-07-28' });
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
});
