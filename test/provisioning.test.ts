import { describe, expect, it, vi } from 'vitest';
import { encryptToken } from '../src/lib/crypto';
import { provisionEvolution } from '../src/index';

const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function jsonApiResponse(status: number, data: Record<string, unknown> | null, errors?: Array<Record<string, unknown>>): Response {
  return new Response(JSON.stringify({ jsonapi: { version: '1.1' }, ...(data ? { data } : {}), ...(errors ? { errors } : {}) }), {
    status,
    headers: { 'content-type': 'application/vnd.api+json' },
  });
}

function fakeDb(audits: Array<Record<string, unknown>>) {
  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('FROM users WHERE email')) return { id: 'user-1', email: values[0] } as T;
              if (sql.includes('SELECT 1 as present')) return undefined;
              if (sql.includes('FROM whatsapp_connections')) return undefined;
              return undefined;
            },
            async run() {
              if (sql.startsWith('INSERT INTO audit_log')) {
                audits.push({ operation: values[3], outcome: values[4], metadata: values[5] });
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function adminEnv(db: D1Database) {
  return {
    DB: db,
    EVOLUTION_BASE_URL: 'https://evolution.invalid',
    EVOLUTION_GLOBAL_API_KEY: 'global-secret',
    TOKEN_ENCRYPTION_KEY: encryptionKey,
  } as any;
}

describe('administrative provisioning outcomes', () => {
  it('records success only after Evolution connect and QR have completed', async () => {
    const audits: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/instance/create')) return jsonApiResponse(201, { type: 'connection', id: 'remote-1' });
      if (url.endsWith('/instance/connect')) return jsonApiResponse(202, { type: 'connection', id: 'remote-1' });
      if (url.endsWith('/instance/qr') && !init?.method) return jsonApiResponse(200, { type: 'qr', id: 'qr-1', attributes: { code: 'qr-code' } });
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);

    await provisionEvolution(adminEnv(fakeDb(audits)), 'https://app.invalid', [{ ownerEmail: 'luccamordente@gmail.com', name: 'lucca', instanceId: 'lucca' }]);

    expect(audits).toEqual([expect.objectContaining({ operation: 'connection_provision', outcome: 'success' })]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://evolution.invalid/instance/create',
      'https://evolution.invalid/instance/connect',
      'https://evolution.invalid/instance/qr',
    ]);
  });

  it('records a sanitized failure after the registry exists but Evolution connect fails', async () => {
    const audits: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/instance/create')) return jsonApiResponse(201, { type: 'connection', id: 'remote-1' });
      if (url.endsWith('/instance/connect')) return jsonApiResponse(502, null, [{ detail: 'upstream token=secret-value failed' }]);
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);

    await expect(provisionEvolution(adminEnv(fakeDb(audits)), 'https://app.invalid', [{ ownerEmail: 'luccamordente@gmail.com', name: 'lucca', instanceId: 'lucca' }])).rejects.toThrow('upstream token=[redacted] failed');
    expect(audits).toEqual([expect.objectContaining({ operation: 'connection_provision', outcome: 'failure', metadata: expect.stringContaining('token=[redacted]') })]);
  });
});
