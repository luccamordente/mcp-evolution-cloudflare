import { describe, expect, it } from 'vitest';
import { adminEmails, buildAdminSnapshot, isAdminOperator, type AdminSnapshotDependencies } from '../src/lib/admin';

type User = { id: string; email: string; status: string; createdAt: string; updatedAt: string };
type Connection = {
  id: string;
  userId: string;
  friendlyName: string;
  instanceId: string;
  phoneNumber?: string;
  encryptedToken: string;
  status: 'active' | 'disabled' | 'error';
  connectionState?: 'connected' | 'qr' | 'offline' | 'error';
  isDefault: number;
  createdAt: string;
  updatedAt: string;
};
type Audit = { userId: string; connectionId: string; operation: string; outcome: 'success' | 'failure'; createdAt: string };

function fakeDb(users: User[], connections: Connection[], audits: Audit[], auditFailure?: Error): D1Database {
  return {
    prepare(sql: string) {
      const all = async <T>(values: unknown[] = []) => {
        if (sql.includes('FROM users')) return { results: users as T[] };
        if (sql.includes('FROM whatsapp_connections')) return { results: connections as T[] };
        if (sql.includes('FROM audit_log')) {
          if (auditFailure) throw auditFailure;
          const [userId, connectionId] = values as [string, string];
          return { results: audits.filter((row) => row.userId === userId && row.connectionId === connectionId).slice(0, 3) as T[] };
        }
        return { results: [] as T[] };
      };
      return {
        all: () => all(),
        bind(...values: unknown[]) { return { all: <T>() => all<T>(values) }; },
      } as never;
    },
  } as unknown as D1Database;
}

const baseEnv = {
  EVOLUTION_BASE_URL: 'https://evolution.invalid',
  TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
} as any;

function statusPayload(attributes: Record<string, unknown>): unknown {
  return { jsonapi: { version: '1.1' }, data: { type: 'connection', id: 'connection-1', attributes } };
}

function dependencies(overrides: Partial<AdminSnapshotDependencies> = {}): AdminSnapshotDependencies {
  return {
    now: () => new Date('2026-10-17T12:00:00.000Z'),
    decryptToken: async () => 'instance-secret',
    readLiveStatus: async () => statusPayload({ connected: true, loggedIn: true, myJid: '5511999999999@s.whatsapp.net' }),
    oauth: {
      listUserGrants: async () => ({ items: [] }),
      lookupClient: async () => null,
    },
    ...overrides,
  };
}

describe('administrative operational snapshot', () => {
  it('uses an independent admin allowlist with identical access for Lucca and Heitor', () => {
    expect(isAdminOperator('LUCCAMORDENTE@GMAIL.COM', {} as any)).toBe(true);
    expect(isAdminOperator('heitorsalazar@gmail.com', {} as any)).toBe(true);
    expect(isAdminOperator('other@example.com', {} as any)).toBe(false);
    expect(adminEmails({ ADMIN_EMAILS: 'admin@example.com', ALLOWED_EMAILS: 'admin@example.com,other@example.com' })).toEqual(new Set(['admin@example.com']));
  });

  it('keeps users without connections or authorizations and redacts operational secrets', async () => {
    const users: User[] = [
      { id: 'u-1', email: 'lucca@example.com', status: 'active', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-02T10:00:00Z' },
      { id: 'u-2', email: 'empty@example.com', status: 'active', createdAt: '2026-10-03T10:00:00Z', updatedAt: '2026-10-03T10:00:00Z' },
    ];
    const connections: Connection[] = [{
      id: 'c-1', userId: 'u-1', friendlyName: 'Lucca', instanceId: 'instance-1', phoneNumber: '5511999999999',
      encryptedToken: 'encrypted-token-secret', status: 'active', connectionState: 'connected', isDefault: 1,
      createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-02T10:00:00Z',
    }];
    const oauth = {
      listUserGrants: async (userId: string) => userId === encodeURIComponent('lucca@example.com') ? ({ items: [{
        id: 'grant-1', clientId: 'client-1', userId, scope: ['mcp:read'], createdAt: 1_700_000_000, expiresAt: 1_900_000_000,
        redirectUri: 'https://client.invalid/callback', accessToken: 'should-not-leak', metadata: { secret: 'should-not-leak' },
      }, {
        id: 'expired-grant', clientId: 'client-1', userId, scope: ['mcp:write'], metadata: {}, createdAt: 1_600_000_000, expiresAt: 1,
      }], cursor: undefined }) : ({ items: [] }),
      lookupClient: async () => ({ clientId: 'client-1', clientName: 'Inspector', redirectUris: [], tokenEndpointAuthMethod: 'none' }),
    };

    const snapshot = await buildAdminSnapshot({ ...baseEnv, DB: fakeDb(users, connections, []) }, dependencies({ oauth }));

    expect(snapshot.users).toHaveLength(2);
    expect(snapshot.users.find((user) => user.id === 'u-2')).toMatchObject({ email: 'empty@example.com', connections: [], authorizations: { status: 'available', authorizations: [], expiredCount: 0 } });
    expect(snapshot.users.find((user) => user.id === 'u-1')?.authorizations).toMatchObject({ status: 'available', expiredCount: 1, authorizations: [{ id: 'grant-1' }] });
    expect(snapshot.users[0].connections[0]).toMatchObject({ id: 'c-1', friendlyName: 'Lucca', live: { state: 'connected', phoneNumber: '5511999999999' }, attention: false });
    expect(JSON.stringify(snapshot)).not.toContain('encrypted-token-secret');
    expect(JSON.stringify(snapshot)).not.toContain('should-not-leak');
    expect(snapshot.generatedAt).toBe('2026-10-17T12:00:00.000Z');
  });

  it('keeps other data when Evolution or OAuth has a partial failure', async () => {
    const users: User[] = [
      { id: 'u-1', email: 'one@example.com', status: 'active', createdAt: '2026-10-01', updatedAt: '2026-10-01' },
      { id: 'u-2', email: 'two@example.com', status: 'active', createdAt: '2026-10-01', updatedAt: '2026-10-01' },
    ];
    const connections: Connection[] = [
      { id: 'c-1', userId: 'u-1', friendlyName: 'Online', instanceId: 'online', encryptedToken: 'x', status: 'active', connectionState: 'connected', isDefault: 1, createdAt: '2026-10-01', updatedAt: '2026-10-01' },
      { id: 'c-2', userId: 'u-2', friendlyName: 'Offline', instanceId: 'offline', encryptedToken: 'y', status: 'active', connectionState: 'connected', isDefault: 1, createdAt: '2026-10-01', updatedAt: '2026-10-01' },
    ];
    const snapshot = await buildAdminSnapshot({ ...baseEnv, DB: fakeDb(users, connections, []) }, dependencies({
      readLiveStatus: async (connection) => {
        if (connection.id === 'c-2') throw new Error('Authorization: Bearer token-secret upstream failed');
        return statusPayload({ connected: true, loggedIn: true });
      },
      oauth: {
        listUserGrants: async (userId) => {
          if (userId === encodeURIComponent('two@example.com')) throw new Error('OAuth provider unavailable secret=oauth-token');
          return { items: [] };
        },
        lookupClient: async () => null,
      },
    }));

    expect(snapshot.users.find((user) => user.id === 'u-1')?.connections[0].live.state).toBe('connected');
    const failedUser = snapshot.users.find((user) => user.id === 'u-2');
    expect(failedUser?.connections[0]).toMatchObject({ attention: true, live: { state: 'unavailable' } });
    expect(failedUser?.authorizations).toMatchObject({ status: 'unavailable', authorizations: [], expiredCount: 0 });
    expect(snapshot.sourceFailures).toHaveLength(2);
    expect(JSON.stringify(snapshot)).not.toContain('token-secret');
  });

  it('keeps live credentials scoped to each connection and OAuth grants scoped to each user', async () => {
    const users: User[] = [
      { id: 'u-1', email: 'one@example.com', status: 'active', createdAt: '2026-10-01', updatedAt: '2026-10-01' },
      { id: 'u-2', email: 'two@example.com', status: 'active', createdAt: '2026-10-01', updatedAt: '2026-10-01' },
    ];
    const connections: Connection[] = [
      { id: 'c-1', userId: 'u-1', friendlyName: 'One', instanceId: 'instance-one', encryptedToken: 'encrypted-one', status: 'active', connectionState: 'connected', isDefault: 1, createdAt: '2026-10-01', updatedAt: '2026-10-01' },
      { id: 'c-2', userId: 'u-2', friendlyName: 'Two', instanceId: 'instance-two', encryptedToken: 'encrypted-two', status: 'active', connectionState: 'connected', isDefault: 1, createdAt: '2026-10-01', updatedAt: '2026-10-01' },
    ];
    const liveCalls: Array<[string, string]> = [];
    const oauthCalls: string[] = [];
    const snapshot = await buildAdminSnapshot({ ...baseEnv, DB: fakeDb(users, connections, []) }, dependencies({
      decryptToken: async (encryptedToken) => encryptedToken.replace('encrypted-', 'instance-'),
      readLiveStatus: async (connection, instanceToken) => {
        liveCalls.push([connection.id, instanceToken]);
        return instanceToken === 'instance-one'
          ? statusPayload({ connected: true, loggedIn: true, myJid: '5511000000000@s.whatsapp.net' })
          : statusPayload({ connected: false, loggedIn: true, myJid: '5511000000001@s.whatsapp.net' });
      },
      oauth: {
        listUserGrants: async (userId) => {
          oauthCalls.push(userId);
          return { items: [] };
        },
        lookupClient: async () => null,
      },
    }));

    expect(liveCalls).toEqual(expect.arrayContaining([['c-1', 'instance-one'], ['c-2', 'instance-two']]));
    expect(oauthCalls).toEqual(expect.arrayContaining([encodeURIComponent('one@example.com'), encodeURIComponent('two@example.com')]));
    expect(snapshot.users.find((user) => user.id === 'u-1')?.connections[0].live.state).toBe('connected');
    expect(snapshot.users.find((user) => user.id === 'u-2')?.connections[0]).toMatchObject({ live: { state: 'offline', phoneNumber: '5511000000001' }, attention: true });
  });

  it('preserves D1 and Evolution data when OAuth initialization is unavailable', async () => {
    const users: User[] = [{ id: 'u-1', email: 'one@example.com', status: 'active', createdAt: '2026-10-01', updatedAt: '2026-10-01' }];
    const connections: Connection[] = [{ id: 'c-1', userId: 'u-1', friendlyName: 'One', instanceId: 'instance-one', encryptedToken: 'encrypted-one', status: 'active', connectionState: 'connected', isDefault: 1, createdAt: '2026-10-01', updatedAt: '2026-10-01' }];
    const snapshot = await buildAdminSnapshot({ ...baseEnv, DB: fakeDb(users, connections, []) }, dependencies({
      oauth: undefined,
      readLiveStatus: async () => statusPayload({ connected: true, loggedIn: true, myJid: '5511000000000@s.whatsapp.net' }),
    }));

    expect(snapshot.users).toHaveLength(1);
    expect(snapshot.users[0].connections[0]).toMatchObject({ live: { available: true, state: 'connected', phoneNumber: '5511000000000' } });
    expect(snapshot.users[0].authorizations).toMatchObject({ status: 'unavailable', authorizations: [], expiredCount: 0 });
    expect(snapshot.sourceFailures).toEqual([expect.objectContaining({ source: 'oauth', userId: 'u-1' })]);
  });

  it('marks audit activity unavailable instead of presenting an empty audit as complete', async () => {
    const users: User[] = [{ id: 'u-1', email: 'one@example.com', status: 'active', createdAt: '2026-10-01', updatedAt: '2026-10-01' }];
    const connections: Connection[] = [{ id: 'c-1', userId: 'u-1', friendlyName: 'One', instanceId: 'instance-one', encryptedToken: 'encrypted-one', status: 'active', connectionState: 'connected', isDefault: 1, createdAt: '2026-10-01', updatedAt: '2026-10-01' }];
    const snapshot = await buildAdminSnapshot({ ...baseEnv, DB: fakeDb(users, connections, [], new Error('audit table unavailable')) }, dependencies());

    expect(snapshot.users[0].connections[0]).toMatchObject({ activity: [], activityStatus: 'unavailable' });
    expect(snapshot.sourceFailures).toEqual([expect.objectContaining({ source: 'audit', userId: 'u-1', connectionId: 'c-1' })]);
  });

  it('derives attention from persisted/live divergence and bounds audit activity to three entries', async () => {
    const users: User[] = [{ id: 'u-1', email: 'one@example.com', status: 'active', createdAt: '2026-10-01', updatedAt: '2026-10-01' }];
    const connections: Connection[] = [{ id: 'c-1', userId: 'u-1', friendlyName: 'Needs review', instanceId: 'instance-1', encryptedToken: 'x', status: 'disabled', connectionState: 'qr', isDefault: 1, createdAt: '2026-10-01', updatedAt: '2026-10-01' }];
    const audits: Audit[] = Array.from({ length: 5 }, (_, index) => ({ userId: 'u-1', connectionId: 'c-1', operation: `op-${index}`, outcome: index === 1 ? 'failure' : 'success', createdAt: `2026-10-0${index + 1}` }));
    const snapshot = await buildAdminSnapshot({ ...baseEnv, DB: fakeDb(users, connections, audits) }, dependencies({ readLiveStatus: async () => statusPayload({ connected: true, loggedIn: true }) }));
    const connection = snapshot.users[0].connections[0];
    expect(connection.attention).toBe(true);
    expect(connection.attentionReasons).toEqual(expect.arrayContaining(['persisted_inactive', 'state_mismatch']));
    expect(connection.activity).toHaveLength(3);
    expect(connection.activity[1]).toMatchObject({ operation: 'op-1', outcome: 'failure' });
  });
});
