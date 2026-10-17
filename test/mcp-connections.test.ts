import { describe, expect, it, vi } from 'vitest';
import { createMcpServer } from '../src/lib/mcp';

function scopedDb() {
  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (sql.startsWith('SELECT id, email FROM users')) {
                return { id: 'db-user-a', email: values[0] } as T;
              }
              return undefined;
            },
            async all<T>() {
              if (sql.includes('FROM whatsapp_connections WHERE user_id = ?1')) {
                return {
                  results: [{
                    id: 'connection-a',
                    friendlyName: 'Lucca',
                    instanceId: 'instance-a',
                    phoneNumber: '5511999999999',
                    isDefault: 1,
                    createdAt: '2026-10-16 10:00:00',
                    updatedAt: '2026-10-16 10:00:00',
                  }] as T[],
                };
              }
              return { results: [] as T[] };
            },
          };
        },
      };
    },
  };
}

describe('list_connections ownership', () => {
  it('returns only connections belonging to the authenticated user', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      data: [
        { instanceName: 'instance-a', owner: 'a@example.com' },
        { instanceName: 'instance-b', owner: 'b@example.com' },
      ],
    }));

    const server = await createMcpServer(
      {
        DB: scopedDb() as unknown as D1Database,
        TOKEN_ENCRYPTION_KEY: 'test-key',
        EVOLUTION_BASE_URL: 'https://evolution.invalid',
        EVOLUTION_GLOBAL_API_KEY: 'global-key',
      } as never,
      { id: 'claim-user-a', email: 'a@example.com', claims: {} },
    );

    const tool = (server as unknown as { _registeredTools: Record<string, { handler: () => Promise<unknown> }> })._registeredTools.list_connections;
    const result = await tool.handler();

    expect(result).toMatchObject({
      structuredContent: {
        data: [{ id: 'connection-a', friendlyName: 'Lucca', instanceId: 'instance-a' }],
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });

  it('does not mask Connection not found with an audit foreign-key error', async () => {
    let auditConnectionId: unknown = 'not-called';
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async first<T>() {
                if (sql.startsWith('SELECT id, email FROM users')) {
                  return { id: 'db-user-a', email: values[0] } as T;
                }
                return undefined;
              },
              async run() {
                if (sql.startsWith('INSERT INTO audit_log')) {
                  auditConnectionId = values[2];
                  if (auditConnectionId !== null) throw new Error('D1_ERROR: FOREIGN KEY constraint failed');
                }
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    };

    const server = await createMcpServer(
      {
        DB: db as unknown as D1Database,
        TOKEN_ENCRYPTION_KEY: 'test-key',
        EVOLUTION_BASE_URL: 'https://evolution.invalid',
      } as never,
      { id: 'claim-user-a', email: 'a@example.com', claims: {} },
    );

    const tool = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<unknown> }> })._registeredTools.connection_status;
    const result = await tool.handler({ connectionId: 'c770126e-773a-408f-9405-89561d05447c' });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: { data: { error: {
        code: 'connection_not_found', status: 404, retryable: false, operation: 'connection_status',
        message: 'Connection not found',
      } } },
    });
    expect(JSON.stringify(result)).not.toContain('FOREIGN KEY');
    expect(auditConnectionId).toBeNull();
  });
});
