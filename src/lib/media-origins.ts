/** Only operator-approved HTTPS storage origins may be fetched or exposed. */
export function approvedMediaOrigins(config?: string, apiBaseUrl?: string): string[] {
  const origins = new Set<string>();
  let excludedOrigin: string | undefined;
  try { excludedOrigin = new URL(apiBaseUrl ?? '').origin; } catch { /* No valid API origin configured. */ }
  for (const entry of (config ?? '').split(',')) {
    try {
      const url = new URL(entry.trim());
      if (url.origin !== excludedOrigin && url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash && !url.origin.includes('*')) origins.add(url.origin);
    } catch { /* Invalid configuration fails closed. */ }
  }
  return [...origins];
}
