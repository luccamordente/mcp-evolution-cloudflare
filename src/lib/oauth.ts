import {
  AuthorizationError,
  OAuthProvider,
  getOAuthApi,
  type AuthRequest,
  type OAuthProviderOptions,
} from '@cloudflare/workers-oauth-provider';
import type { Env, AuthenticatedUser } from '../types';
import { authenticateAccessRequest, AuthError } from './auth';
import { createMcpServer } from './mcp';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { logOAuthError } from './oauth-diagnostics';

const scopesSupported = ['mcp:read', 'mcp:write', 'offline_access'];

/**
 * The canonical resource is set by MCP_PUBLIC_URL at deployment time. Keeping
 * this value in configuration makes token audiences byte-for-byte stable and
 * avoids deriving an audience from an untrusted Host header.
 */
export function oauthOptions(resourceBaseUrl: string, fallback?: ExportedHandler<Env>['fetch']): OAuthProviderOptions<Env> {
  const resource = `${resourceBaseUrl.replace(/\/$/, '')}/mcp`;
  return {
    apiRoute: '/mcp',
    apiHandler: {
      async fetch(request, env, ctx) {
        const props = (ctx as ExecutionContext & { props?: { user?: AuthenticatedUser } }).props;
        const user = props?.user;
        if (!user) return Response.json({ error: 'OAuth user context missing' }, { status: 500 });
        const auth = (ctx as ExecutionContext & { auth?: { token: string; clientId?: string; scope: string[]; expiresAt?: number } }).auth;
        const server = await createMcpServer(env, user);
        const handler = createMcpHandler(() => server, {
          legacy: 'reject',
          responseMode: 'json',
          maxRequestBodySize: Number(env.MAX_MEDIA_BYTES ?? 8 * 1024 * 1024),
        });
        return handler.fetch(request, auth ? {
          authInfo: {
            token: auth.token,
            clientId: auth.clientId ?? 'oauth-client',
            scopes: auth.scope,
            expiresAt: auth.expiresAt,
          },
        } : undefined);
      },
    },
    defaultHandler: {
      async fetch(request, env, ctx) {
        if (new URL(request.url).pathname === '/authorize') return authorizationUi(request, env, resource);
        return fallback ? fallback(request, env, ctx) : new Response('Not found', { status: 404 });
      },
    },
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    onError: logOAuthError,
    scopesSupported,
    requiredScopes: ['mcp:read'],
    resourceMetadata: {
      resource,
      authorization_servers: [resourceBaseUrl.replace(/\/$/, '')],
      resource_name: 'Evolution Go WhatsApp MCP',
    },
    clientIdMetadataDocumentEnabled: true,
  };
}

/** Build the combined OAuth provider once the deployment URL is known. */
export function createOAuthProvider(resourceBaseUrl: string, fallback?: ExportedHandler<Env>['fetch']): OAuthProvider<Env> {
  return new OAuthProvider(oauthOptions(resourceBaseUrl, fallback));
}

async function authorizationUi(request: Request, env: Env, resource: string): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/authorize') {
    return new Response('Not found', { status: 404 });
  }

  let user: AuthenticatedUser;
  try {
    user = await authenticateAccessRequest(request, env);
  } catch (error) {
    const authError = error instanceof AuthError ? error : new AuthError(500, 'Access authentication failed');
    // Access should protect this route and present the PIN screen. Returning
    // JSON here prevents an HTML login page from being mistaken for MCP data.
    return Response.json({ error: authError.message }, { status: authError.status, headers: { 'Cache-Control': 'no-store' } });
  }

  const options = oauthOptions(resource.slice(0, -4));
  const oauth = getOAuthApi(options, env);
  try {
    if (request.method === 'GET') {
      const authRequest = await oauth.parseAuthRequest(request);
      const transaction = await oauth.beginConsent(authRequest);
      const description = await oauth.describeConsent(authRequest);
      const html = consentHtml(description.clientName, description.redirectHost, description.scope, transaction.handle);
      return new Response(html, { headers: { ...Object.fromEntries(transaction.headers), 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, POST' } });
    const form = await request.formData();
    const handle = String(form.get('handle') ?? '');
    const decision = String(form.get('decision') ?? 'deny');
    if (decision !== 'allow') {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: { ...Object.fromEntries(denied.headers), Location: denied.redirectTo, 'Cache-Control': 'no-store' } });
    }
    const approved = await oauth.approveConsent(request, handle, {
      remember: { secret: env.CONSENT_SECRET ?? env.TOKEN_ENCRYPTION_KEY, subject: encodeURIComponent(user.email) },
    });
    const completed = await oauth.completeAuthorization({
      request: approved.request,
      userId: encodeURIComponent(user.email),
      metadata: { email: user.email },
      scope: approved.request.scope,
      props: { user },
    });
    return new Response(null, { status: 302, headers: { ...Object.fromEntries(approved.headers), Location: completed.redirectTo, 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) {
      return new Response(null, { status: 302, headers: { Location: error.redirectTo, 'Cache-Control': 'no-store' } });
    }
    return Response.json({ error: 'Authorization request could not be completed' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}

function consentHtml(clientName: string, redirectHost: string, scopes: string[], handle: string): string {
  const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Autorizar MCP</title><body><main><h1>Autorizar acesso ao Evolution Go</h1><p><strong>${esc(clientName)}</strong> solicita acesso para redirecionar a resposta a <code>${esc(redirectHost)}</code>.</p><p>Permissões: ${scopes.map(esc).join(', ') || 'nenhuma'}</p><form method="post" action="/authorize"><input type="hidden" name="handle" value="${esc(handle)}"><button name="decision" value="allow" type="submit">Permitir</button><button name="decision" value="deny" type="submit">Negar</button></form></main></body></html>`;
}

