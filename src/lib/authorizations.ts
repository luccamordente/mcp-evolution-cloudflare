import type { ClientInfo, GrantSummary, ListOptions, OAuthHelpers } from '@cloudflare/workers-oauth-provider';

export interface AuthorizationSummary {
  id: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  createdAt: number;
  expiresAt?: number;
  resource?: string;
  redirectHost?: string;
}

export interface AuthorizationPage {
  authorizations: AuthorizationSummary[];
  nextCursor?: string;
}

/** Provider grant identifiers are opaque, but constrain them before passing
 * them into a revocation call or audit record. */
export function isValidAuthorizationId(value: string): boolean {
  return /^[A-Za-z0-9._~-]{1,256}$/.test(value);
}

const FALLBACK_CLIENT_NAME = 'Cliente OAuth';

/** Convert the provider's public grant summary into the deliberately small
 * contract exposed to the browser. Provider metadata and credentials never
 * cross this boundary. */
export async function summarizeGrant(oauth: Pick<OAuthHelpers, 'lookupClient'>, grant: GrantSummary): Promise<AuthorizationSummary> {
  let client: ClientInfo | null = null;
  try { client = await oauth.lookupClient(grant.clientId); } catch { /* CIMD metadata may be unavailable. */ }
  const redirectUri = typeof grant.redirectUri === 'string' ? grant.redirectUri : undefined;
  let redirectHost: string | undefined;
  try {
    const parsed = redirectUri ? new URL(redirectUri) : undefined;
    if (parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:')) redirectHost = parsed.host.slice(0, 255);
  } catch { /* Keep the grant visible with no installation hint. */ }
  const rawResource = grant.resource;
  const resource = typeof rawResource === 'string' ? rawResource.slice(0, 512) : Array.isArray(rawResource) && typeof rawResource[0] === 'string' ? rawResource[0].slice(0, 512) : undefined;
  const clientName = typeof client?.clientName === 'string' && client.clientName.trim() ? client.clientName.trim().slice(0, 160) : FALLBACK_CLIENT_NAME;
  return {
    id: grant.id,
    clientId: grant.clientId,
    clientName,
    scopes: Array.isArray(grant.scope) ? grant.scope.filter((scope): scope is string => typeof scope === 'string').slice(0, 32) : [],
    createdAt: grant.createdAt,
    ...(typeof grant.expiresAt === 'number' ? { expiresAt: grant.expiresAt } : {}),
    ...(resource ? { resource } : {}),
    ...(redirectHost ? { redirectHost } : {}),
  };
}

export async function listAuthorizations(oauth: Pick<OAuthHelpers, 'listUserGrants' | 'lookupClient'>, userId: string, options: ListOptions = {}): Promise<AuthorizationPage> {
  const page = await oauth.listUserGrants(userId, options);
  const now = Math.floor(Date.now() / 1000);
  const active = page.items.filter((grant) => typeof grant.expiresAt !== 'number' || grant.expiresAt > now);
  const authorizations = await Promise.all(active.map((grant) => summarizeGrant(oauth, grant)));
  return { authorizations, ...(page.cursor ? { nextCursor: page.cursor } : {}) };
}

export function authorizationListOptions(cursor: string | undefined, rawLimit: string | undefined): ListOptions {
  const parsed = rawLimit ? Number(rawLimit) : 25;
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 50) : 25;
  return { limit, ...(cursor ? { cursor: cursor.slice(0, 512) } : {}) };
}
