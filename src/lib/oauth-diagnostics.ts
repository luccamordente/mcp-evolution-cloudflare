interface OAuthErrorDiagnostic {
  code: string;
  status: number;
  internal?: {
    category?: string;
    reason?: string;
  };
}

/**
 * Record only the provider's stable, server-side error classification. OAuth
 * descriptions, headers, requests and token values are intentionally omitted.
 */
export function logOAuthError(error: OAuthErrorDiagnostic): void {
  console.warn('[DEBUG-OAUTH-REFRESH]', {
    code: error.code,
    status: error.status,
    category: error.internal?.category,
    reason: error.internal?.reason,
  });
}
