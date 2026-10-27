import { describe, expect, it, vi } from 'vitest';
import { repointUserConnection } from '../src/index';
import { decryptToken } from '../src/lib/crypto';
import { EvolutionApiError } from '../src/lib/evolution';

const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
type Row = { id: string; user_id: string; instance_id: string; encrypted_token: string; webhook_secret_hash: string; is_default: number };

function env(rows: Row[], audits: unknown[][] = []) {
  const DB = {
    prepare(sql: string) {
      let a: unknown[] = [];
      const st = {
        bind(...v: unknown[]) { a = v; return st; },
        async first() {
          if (sql.includes('WHERE id = ?1 AND user_id = ?2')) { const r = rows.find((x) => x.id === a[0] && x.user_id === a[1]); return r ? { id: r.id, userId: r.user_id, instanceId: r.instance_id, encryptedToken: r.encrypted_token } : null; }
          if (sql.includes('WHERE instance_id = ?1 AND user_id = ?2')) { const r = rows.find((x) => x.instance_id === a[0] && x.user_id === a[1]); return r ? { id: r.id, instanceId: r.instance_id } : null; }
          return null;
        },
        async run() {
          if (sql.startsWith('UPDATE whatsapp_connections SET instance_id')) {
            const r = rows.find((x) => x.id === a[2] && x.user_id === a[3]);
            if (r) { r.instance_id = a[0] as string; r.encrypted_token = a[1] as string; }
            return { meta: { changes: r ? 1 : 0 } };
          }
          if (sql.startsWith('INSERT INTO audit_log')) audits.push(a);
          return { meta: { changes: 1 } };
        },
      };
      return st;
    },
  };
  return { DB, TOKEN_ENCRYPTION_KEY: KEY, EVOLUTION_BASE_URL: 'https://evo.test' } as never;
}
const rowsFor = (): Row[] => [
  { id: 'c1', user_id: 'u1', instance_id: 'old-inst', encrypted_token: 'enc-old', webhook_secret_hash: 'hash1', is_default: 1 },
  { id: 'c2', user_id: 'u1', instance_id: 'taken-inst', encrypted_token: 'enc-2', webhook_secret_hash: 'hash2', is_default: 0 },
];
const okStatus = (id = 'new-inst') => ({ status: vi.fn().mockResolvedValue({ jsonapi: { version: '1.1' }, data: { type: 'connection', id, attributes: { connected: true, loggedIn: true } } }) });

describe('repointUserConnection', () => {
  it('validates, encrypts and repoints in place keeping id, default and webhook hash', async () => {
    const rows = rowsFor(); const audits: unknown[][] = []; const admin = okStatus();
    const [body, status] = await repointUserConnection(env(rows, audits), 'u1', 'c1', { instanceId: 'new-inst', instanceToken: 'tok-new' }, admin as never);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, id: 'c1', instanceId: 'new-inst', previousInstanceId: 'old-inst' });
    expect(JSON.stringify(body)).not.toContain('tok-new');
    expect(admin.status).toHaveBeenCalledWith('tok-new');
    const r = rows[0];
    expect(r).toMatchObject({ id: 'c1', instance_id: 'new-inst', is_default: 1, webhook_secret_hash: 'hash1' });
    expect(r.encrypted_token).not.toContain('tok-new');
    expect(await decryptToken(r.encrypted_token, KEY)).toBe('tok-new');
    expect(audits).toHaveLength(1);
    expect(audits[0][3]).toBe('connection_repoint');
    expect(audits[0][4]).toBe('success');
    expect(String(audits[0][5])).not.toContain('tok-new');
  });
  it('accepts instanceName and stores the canonical id reported by Evolution', async () => {
    const rows = rowsFor();
    const [body, status] = await repointUserConnection(env(rows), 'u1', 'c1', { instanceName: 'zname', instanceToken: 't' }, okStatus('uuid-1') as never);
    expect(status).toBe(200);
    expect(body).toMatchObject({ instanceId: 'uuid-1' });
    expect(rows[0].instance_id).toBe('uuid-1');
  });
  it('returns 404 for another user\'s connection and never calls Evolution', async () => {
    const rows = rowsFor(); const admin = okStatus();
    const [, status] = await repointUserConnection(env(rows), 'u2', 'c1', { instanceId: 'new-inst', instanceToken: 't' }, admin as never);
    expect(status).toBe(404);
    expect(admin.status).not.toHaveBeenCalled();
    expect(rows[0].instance_id).toBe('old-inst');
  });
  it('returns 400 when fields are missing', async () => {
    const [, status] = await repointUserConnection(env(rowsFor()), 'u1', 'c1', { instanceId: 'x' }, okStatus() as never);
    expect(status).toBe(400);
  });
  it('returns 422 and saves nothing when Evolution rejects the token', async () => {
    const rows = rowsFor(); const audits: unknown[][] = [];
    const admin = { status: vi.fn().mockRejectedValue(new EvolutionApiError(401, 'unauthorized')) };
    const [, status] = await repointUserConnection(env(rows, audits), 'u1', 'c1', { instanceId: 'new-inst', instanceToken: 'bad' }, admin as never);
    expect(status).toBe(422);
    expect(rows[0]).toMatchObject({ instance_id: 'old-inst', encrypted_token: 'enc-old' });
    expect(audits[0][4]).toBe('failure');
  });
  it('returns 502 and saves nothing when Evolution is unreachable', async () => {
    const rows = rowsFor();
    const [, status] = await repointUserConnection(env(rows), 'u1', 'c1', { instanceId: 'new-inst', instanceToken: 't' }, { status: vi.fn().mockRejectedValue(new EvolutionApiError(503, 'down')) } as never);
    expect(status).toBe(502);
    expect(rows[0].instance_id).toBe('old-inst');
  });
  it('returns 422 when the token belongs to a different instance', async () => {
    const rows = rowsFor();
    const [, status] = await repointUserConnection(env(rows), 'u1', 'c1', { instanceId: 'new-inst', instanceToken: 't' }, okStatus('other') as never);
    expect(status).toBe(422);
    expect(rows[0].instance_id).toBe('old-inst');
  });
  it('returns 409 when another of the user\'s connections already uses the instance', async () => {
    const rows = rowsFor();
    const [, status] = await repointUserConnection(env(rows), 'u1', 'c1', { instanceId: 'taken-inst', instanceToken: 't' }, okStatus('taken-inst') as never);
    expect(status).toBe(409);
    expect(rows[0].instance_id).toBe('old-inst');
  });
});
