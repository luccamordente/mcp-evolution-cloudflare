import { describe, expect, it, vi } from 'vitest';
import { authorizationListOptions, isValidAuthorizationId, listAuthorizations, summarizeGrant } from '../src/lib/authorizations';

describe('OAuth authorization summaries', () => {
  it('allowlists grant fields and resolves a friendly client name', async () => {
    const oauth = { lookupClient: vi.fn().mockResolvedValue({ clientId: 'client-1', clientName: 'Inspector', redirectUris: ['https://client.invalid/cb'] }) };
    const result = await summarizeGrant(oauth as never, {
      id: 'grant-1', clientId: 'client-1', userId: 'user-1', scope: ['mcp:read'], metadata: { email: 'a@example.com', secret: 'never' },
      createdAt: 1_700_000_000, expiresAt: 1_800_000_000, redirectUri: 'https://client.invalid/cb', resource: 'https://mcp.invalid/mcp', accessToken: 'secret',
    } as never);
    expect(result).toEqual({ id: 'grant-1', clientId: 'client-1', clientName: 'Inspector', scopes: ['mcp:read'], createdAt: 1_700_000_000, expiresAt: 1_800_000_000, resource: 'https://mcp.invalid/mcp', redirectHost: 'client.invalid' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('uses a safe fallback when client metadata cannot be resolved and paginates', async () => {
    const oauth = {
      lookupClient: vi.fn().mockRejectedValue(new Error('metadata unavailable')),
      listUserGrants: vi.fn().mockResolvedValue({ items: [{ id: 'grant-1', clientId: 'https://client.invalid/meta', userId: 'user-1', scope: [], metadata: {}, createdAt: 10 }], cursor: 'next' }),
    };
    const result = await listAuthorizations(oauth as never, 'user-1', { cursor: 'old', limit: 2 });
    expect(oauth.listUserGrants).toHaveBeenCalledWith('user-1', { cursor: 'old', limit: 2 });
    expect(result).toEqual({ authorizations: [{ id: 'grant-1', clientId: 'https://client.invalid/meta', clientName: 'Cliente OAuth', scopes: [], createdAt: 10, resource: undefined, redirectHost: undefined }], nextCursor: 'next' });
  });

  it('filters expired grants using provider Unix-second timestamps while retaining pagination', async () => {
    vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
    const oauth = {
      lookupClient: vi.fn().mockResolvedValue({ clientName: 'Inspector' }),
      listUserGrants: vi.fn().mockResolvedValue({ items: [
        { id: 'active', clientId: 'client', scope: ['mcp:read'], createdAt: 1_700_000_000, expiresAt: 1_800_000_000 },
        { id: 'expired', clientId: 'client', scope: ['mcp:write'], createdAt: 1_700_000_000, expiresAt: 1 },
      ], cursor: 'next-page' }),
    };
    await expect(listAuthorizations(oauth as never, 'user-1')).resolves.toEqual({
      authorizations: [{ id: 'active', clientId: 'client', clientName: 'Inspector', scopes: ['mcp:read'], createdAt: 1_700_000_000, expiresAt: 1_800_000_000 }],
      nextCursor: 'next-page',
    });
    vi.useRealTimers();
  });

  it('clamps pagination input while preserving opaque cursors', () => {
    expect(authorizationListOptions('x'.repeat(600), '-4')).toEqual({ limit: 1, cursor: 'x'.repeat(600) });
    expect(authorizationListOptions(undefined, '999')).toEqual({ limit: 50 });
    expect(authorizationListOptions(undefined, 'invalid')).toEqual({ limit: 25 });
  });

  it('accepts only bounded opaque provider identifiers for revocation', () => {
    expect(isValidAuthorizationId('grant_abc-123.')).toBe(true);
    expect(isValidAuthorizationId('grant/other')).toBe(false);
    expect(isValidAuthorizationId('x'.repeat(257))).toBe(false);
  });
});
