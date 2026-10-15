import { afterEach, describe, expect, it, vi } from 'vitest';
import { logOAuthError } from '../src/lib/oauth-diagnostics';

describe('OAuth diagnostics', () => {
  afterEach(() => vi.restoreAllMocks());

  it('records a sanitized internal reason for token endpoint errors', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logOAuthError({
      code: 'invalid_grant',
      status: 400,
      internal: { category: 'refresh-token-grant', reason: 'refresh_token_mismatch' },
    });

    expect(warn).toHaveBeenCalledWith('[DEBUG-OAUTH-REFRESH]', {
      code: 'invalid_grant',
      status: 400,
      category: 'refresh-token-grant',
      reason: 'refresh_token_mismatch',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('refresh token');
  });
});
