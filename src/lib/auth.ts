import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AuthenticatedUser, Env } from '../types';
import type { AuthInfo } from '@modelcontextprotocol/server';

function bearer(request: Request): string | null {
  const value = request.headers.get('authorization');
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1] ?? null;
}

function allowedEmails(env: Env): Set<string> {
  const configured = (env.ALLOWED_EMAILS ?? 'luccamordente@gmail.com,heitorsalazar@gmail.com').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return new Set(configured);
}

function emailFromClaims(payload: JWTPayload): string | undefined {
  const candidates = [payload.email, payload.preferred_username, payload.upn, payload['https://claims.access.email']];
  return candidates.find((x): x is string => typeof x === 'string' && x.includes('@'))?.toLowerCase();
}

export async function authenticate(request: Request, env: Env): Promise<{ info: AuthInfo; user: AuthenticatedUser }> {
  const token = bearer(request);
  if (!token) throw new AuthError(401, 'Missing bearer token');
  const payload = await verifyAccessJwt(token, env);
  const email = emailFromClaims(payload);
  if (!email || !allowedEmails(env).has(email)) throw new AuthError(403, 'User is not authorized');
  const id = typeof payload.sub === 'string' && payload.sub ? payload.sub : email;
  const expiresAt = typeof payload.exp === 'number' ? payload.exp : undefined;
  const info: AuthInfo = { token, clientId: typeof payload.azp === 'string' ? payload.azp : 'cloudflare-access', scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [], expiresAt, extra: { email, claims: payload } };
  return { info, user: { id, email, name: typeof payload.name === 'string' ? payload.name : undefined, claims: payload as Record<string, unknown> } };
}

/**
 * Verify the JWT Cloudflare Access adds to requests that pass an Access policy.
 * This is deliberately separate from MCP bearer-token verification: an Access
 * assertion authenticates the browser at /authorize and the connection UI; it
 * is never accepted as an MCP OAuth access token.
 */
export async function authenticateAccessRequest(request: Request, env: Env): Promise<AuthenticatedUser> {
  if (env.ENVIRONMENT === 'local') {
    const email = (env.LOCAL_DEV_USER_EMAIL ?? 'dev@example.test').trim().toLowerCase();
    if (!email || !email.includes('@')) throw new AuthError(500, 'Local development user is not configured');
    return { id: `local:${email}`, email, name: 'Local development', claims: { local: true } };
  }
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) throw new AuthError(401, 'Cloudflare Access authentication required');
  const payload = await verifyAccessJwt(token, env);
  const email = emailFromClaims(payload);
  if (!email || !allowedEmails(env).has(email)) throw new AuthError(403, 'User is not authorized');
  const id = typeof payload.sub === 'string' && payload.sub ? payload.sub : email;
  return { id, email, name: typeof payload.name === 'string' ? payload.name : undefined, claims: payload as Record<string, unknown> };
}

async function verifyAccessJwt(token: string, env: Env): Promise<JWTPayload> {
  if (!env.ACCESS_JWKS_URL || !env.ACCESS_ISSUER || !env.ACCESS_AUDIENCE) throw new AuthError(503, 'Cloudflare Access verifier is not configured');
  try {
    const jwks = createRemoteJWKSet(new URL(env.ACCESS_JWKS_URL));
    const verified = await jwtVerify(token, jwks, {
      issuer: env.ACCESS_ISSUER,
      audience: env.ACCESS_AUDIENCE,
      algorithms: ['RS256', 'ES256'],
    });
    return verified.payload;
  } catch (error) {
    throw new AuthError(401, 'Invalid Cloudflare Access token', error instanceof Error ? error.message : undefined);
  }
}

export class AuthError extends Error {
  constructor(public readonly status: number, message: string, public readonly detail?: unknown) { super(message); this.name = 'AuthError'; }
}

export function authResponse(error: AuthError): Response {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  if (error.status === 401) headers.set('WWW-Authenticate', 'Bearer');
  return new Response(JSON.stringify({ error: error.message }), { status: error.status, headers });
}
