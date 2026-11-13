import { createClerkClient } from '@clerk/backend';
import type { AuthenticatedUser, Env } from '../types';
import { AuthError } from './auth-error';
import { bootstrapLocalUser } from './db';
import { authScripts, authPage } from '../ui/auth';
import { timingSafeEqual } from 'node:crypto';
export { AuthError } from './auth-error';

export function browserOrigin(env: Env): string {
  try {
    const url = new URL(env.MCP_PUBLIC_URL ?? '');
    if (url.protocol !== 'https:' && !(env.ENVIRONMENT === 'local' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error();
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw new AuthError(503, 'O acesso ao WaPilot está indisponível.'); }
}

export function clerkFrontend(env: Env): string {
  try {
    const key = env.CLERK_PUBLISHABLE_KEY ?? '';
    if (!/^pk_(live|test)_[A-Za-z0-9+/=]+$/.test(key)) throw new Error();
    const value = atob(key.split('_')[2]);
    if (!value.endsWith('$')) throw new Error();
    const url = new URL('https://' + value.slice(0, -1));
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password || url.port) throw new Error();
    return url.origin;
  } catch { throw new AuthError(503, 'O acesso ao WaPilot está indisponível.'); }
}

export function safeReturnPath(value: string | null, env: Env): string {
  try {
    const origin = browserOrigin(env);
    const url = new URL(value ?? '/connections', origin);
    if (url.origin !== origin || !['/connections', '/admin', '/authorize'].includes(url.pathname) || url.username || url.password) return '/connections';
    const allowed = url.pathname === '/authorize' ? ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'resource', 'code_challenge', 'code_challenge_method', 'response_mode'] : url.pathname === '/connections' ? ['provision', 'refresh'] : [];
    for (const key of [...url.searchParams.keys()]) if (!allowed.includes(key)) url.searchParams.delete(key);
    return url.pathname + url.search;
  } catch { return '/connections'; }
}

function pageNavigation(request: Request): boolean {
  return request.method === 'GET' && ['/connections', '/admin', '/authorize'].includes(new URL(request.url).pathname) && (request.headers.get('accept') ?? '').includes('text/html');
}

export function appendAuthHeaders(response: Response, headers: Headers): Response {
  const output = new Response(response.body, response);
  for (const [name, value] of headers) if (name !== 'set-cookie') output.headers.set(name, value);
  for (const value of headers.getSetCookie()) output.headers.append('Set-Cookie', value);
  output.headers.set('Cache-Control', 'no-store');
  return output;
}

export function browserSessionScripts(env: Env, mode = 'session', returnTo = '/connections'): string {
  if (env.ENVIRONMENT === 'local') return '';
  return authScripts(env.CLERK_PUBLISHABLE_KEY ?? '', clerkFrontend(env), mode, safeReturnPath(returnTo, env));
}

const csrfCookie = '__Host-wapilot_csrf';
function csrfFromRequest(request: Request): string | undefined {
  return request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(csrfCookie + '='))?.slice(csrfCookie.length + 1);
}

export function browserCsrfCookie(request: Request, env: Env): string | undefined {
  if (env.ENVIRONMENT === 'local' || !['GET', 'HEAD'].includes(request.method) || /^[A-Za-z0-9_-]{43}$/.test(csrfFromRequest(request) ?? '')) return;
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${csrfCookie}=${token}; Path=/; Secure; SameSite=Strict`;
}

export function assertBrowserMutation(request: Request, env: Env): void {
  if (env.ENVIRONMENT === 'local' || ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const cookie = csrfFromRequest(request) ?? '', header = request.headers.get('x-wapilot-csrf') ?? '';
  if (request.headers.get('origin') !== browserOrigin(env) || request.headers.get('sec-fetch-site') === 'cross-site' || !/^[A-Za-z0-9_-]{43}$/.test(cookie) || !/^[A-Za-z0-9_-]{43}$/.test(header) || !timingSafeEqual(new TextEncoder().encode(cookie), new TextEncoder().encode(header))) throw new AuthError(403, 'Esta ação precisa ser iniciada no WaPilot.');
}

export async function authenticateBrowserRequest(request: Request, env: Env): Promise<{ user: AuthenticatedUser; headers: Headers } | Response> {
  let responseHeaders = new Headers();
  try {
    if (env.ENVIRONMENT === 'local') {
      const email = (env.LOCAL_DEV_USER_EMAIL ?? 'dev@example.test').trim().toLowerCase();
      if (!email || !email.includes('@')) throw new AuthError(503, 'O acesso local ao WaPilot não está configurado.');
      const local = { id: 'local:' + email, email, claims: { local: true } };
      const user = await bootstrapLocalUser(env.DB, local);
      return { user: { ...user, claims: {} }, headers: new Headers() };
    }
    const origin = browserOrigin(env);
    const issuer = clerkFrontend(env);
    if (!env.CLERK_SECRET_KEY || new URL(request.url).origin !== origin) throw new AuthError(503, 'O acesso ao WaPilot está indisponível.');
    const headers = new Headers(request.headers);
    headers.delete('authorization');
    const verificationUrl = new URL(request.url);
    verificationUrl.searchParams.delete('__clerk_redirect_url');
    verificationUrl.searchParams.delete('__clerk_ticket');
    const client = createClerkClient({ secretKey: env.CLERK_SECRET_KEY, publishableKey: env.CLERK_PUBLISHABLE_KEY });
    const state = await client.authenticateRequest(new Request(verificationUrl, { method: request.method, headers }), { acceptsToken: 'session_token', issuer, authorizedParties: [origin], jwtKey: env.CLERK_JWT_KEY });
    responseHeaders = state.headers;
    const location = state.headers.get('location');
    if (location) {
      if (![origin, issuer].includes(new URL(location).origin)) { responseHeaders.delete('location'); throw new AuthError(503, 'Não foi possível verificar o acesso ao WaPilot.'); }
      return appendAuthHeaders(new Response(null, { status: 307 }), state.headers);
    }
    if (state.status === 'handshake') throw new AuthError(503, 'Não foi possível verificar o acesso ao WaPilot.');
    if (!state.isAuthenticated) {
      if (/jwk.*(failed|missing|invalid)|secret-key-invalid|unexpected-error/i.test(state.reason ?? '')) throw new AuthError(503, 'Não foi possível verificar o acesso ao WaPilot.');
      if (pageNavigation(request)) {
        const url = new URL(request.url);
        return appendAuthHeaders(new Response(null, { status: 302, headers: { Location: '/sign-in?' + new URLSearchParams({ returnTo: safeReturnPath(url.pathname + url.search, env) }) } }), state.headers);
      }
      return appendAuthHeaders(authResponse(new AuthError(401, 'Entre no WaPilot para continuar.')), state.headers);
    }
    const auth = state.toAuth();
    if (!auth?.userId || !('sessionClaims' in auth) || auth.sessionClaims.azp !== origin) throw new AuthError(401, 'Entre no WaPilot para continuar.');
    const owner = await env.DB.prepare('SELECT id, email, status FROM users WHERE clerk_user_id = ?').bind(auth.userId).first<{ id: string; email: string; status: string }>();
    if (!owner) throw new AuthError(403, 'Sua conta aguarda ativação por um administrador do WaPilot.');
    if (owner.status !== 'active') throw new AuthError(403, 'Esta conta não tem acesso ao WaPilot.');
    return { user: { id: owner.id, email: owner.email, claims: {} }, headers: state.headers };
  } catch (error) {
    const failure = error instanceof AuthError ? error : new AuthError(503, 'Não foi possível verificar o acesso ao WaPilot.');
    if (failure.status === 403 && pageNavigation(request)) return appendAuthHeaders(new Response(authPage('Acesso ao WaPilot', failure.message, browserSessionScripts(env, 'message')), { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer' } }), responseHeaders);
    return appendAuthHeaders(authResponse(failure), responseHeaders);
  }
}

export function authResponse(error: AuthError): Response {
  return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
}
