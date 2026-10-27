import {
  AuthorizationError,
  OAuthProvider,
  getOAuthApi,
  insufficientScope,
  type OAuthResourceAuth,
  type AuthRequest,
  type OAuthProviderOptions,
} from '@cloudflare/workers-oauth-provider';
import type { Env, AuthenticatedUser } from '../types';
import { authenticateAccessRequest, AuthError } from './auth';
import { callsWriteTool, createMcpServer, mcpBodyLimit, WRITE_SCOPE } from './mcp';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { logOAuthError } from './oauth-diagnostics';
import { WAPILOT_LOGO_SVG } from '../ui/wapilot-logo';

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
        // Step-up: a send tool called with a read-only token gets a standard 403
        // insufficient_scope challenge naming mcp:write, so clients can re-authorize.
        if (auth && !auth.scope.includes(WRITE_SCOPE) && request.method === 'POST' && await callsWriteTool(request)) {
          return insufficientScope(auth as unknown as OAuthResourceAuth, ['mcp:read', WRITE_SCOPE], 'Sending WhatsApp messages requires the mcp:write scope.');
        }
        const server = await createMcpServer(env, user);
        const handler = createMcpHandler(() => server, {
          legacy: 'stateless',
          responseMode: 'json',
          maxRequestBodySize: mcpBodyLimit(env),
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
      revokeExistingGrants: false,
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
  const scopeLabels: Record<string, string> = {
    'mcp:read': 'Consultar seus dados do WhatsApp',
    'mcp:write': 'Enviar mensagens e executar ações autorizadas',
    offline_access: 'Continuar conectado quando você não estiver usando o app',
  };
  const requestedScopes = scopes.length
    ? scopes.map((scope) => `<li><span class="permission-icon" aria-hidden="true">✓</span><span>${esc(scopeLabels[scope] ?? scope)}</span></li>`).join('')
    : '<li><span class="permission-icon" aria-hidden="true">✓</span><span>Nenhuma permissão adicional</span></li>';

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f7faf9">
  <title>Conectar ao WaPilot</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@700;800&display=swap" rel="stylesheet">
  <style>
    :root { color-scheme: light; --ink:#0f1b25; --muted:#667789; --line:#dfe9e6; --canvas:#f7faf9; --surface:#fff; --mint:#e9f8f0; --mint-strong:#d3f3e0; --green:#25d366; --green-deep:#108b45; --shadow:0 22px 60px rgba(20,61,39,.11); font-family:"DM Sans",system-ui,sans-serif; }
    * { box-sizing:border-box; }
    html { min-width:320px; background:var(--canvas); }
    body { min-height:100vh; margin:0; color:var(--ink); background:var(--canvas); }
    button { font:inherit; cursor:pointer; -webkit-tap-highlight-color:transparent; }
    button:focus-visible { outline:3px solid rgba(32,200,102,.4); outline-offset:3px; }
    .app { min-height:100vh; display:flex; flex-direction:column; }
    .topbar { display:flex; align-items:center; justify-content:space-between; min-height:84px; padding:0 52px; background:var(--surface); border-bottom:1px solid var(--line); }
    .brand { display:inline-flex; align-items:center; width:142px; }
    .brand svg { display:block; width:100%; height:auto; }
    .secure-label { display:inline-flex; align-items:center; gap:8px; color:var(--muted); font-size:13px; font-weight:700; }
    .secure-dot { width:8px; height:8px; border-radius:50%; background:var(--green); box-shadow:0 0 0 4px rgba(37,211,102,.14); }
    main { width:min(1050px, calc(100% - 48px)); margin:0 auto; padding:72px 0 88px; }
    .intro { max-width:690px; margin:0 auto 30px; text-align:center; }
    .eyebrow { margin:0 0 12px; color:var(--green-deep); font-size:11px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; }
    h1, h2 { margin:0; font-family:"Manrope","DM Sans",sans-serif; letter-spacing:-.04em; }
    h1 { font-size:clamp(36px, 5vw, 58px); line-height:1.02; }
    .lede { max-width:570px; margin:16px auto 0; color:var(--muted); font-size:16px; line-height:1.55; }
    .consent-card { display:grid; grid-template-columns:minmax(0, 1.02fr) minmax(300px, .98fr); overflow:hidden; background:var(--surface); border:1px solid var(--line); border-radius:24px; box-shadow:var(--shadow); }
    .request-panel { padding:42px; }
    .request-mark { display:grid; place-items:center; width:62px; height:62px; margin-bottom:22px; color:var(--green-deep); background:var(--mint-strong); border-radius:18px; font-size:31px; }
    .request-panel h2 { font-size:31px; line-height:1.08; }
    .request-copy { margin:14px 0 28px; color:var(--muted); line-height:1.55; }
    .request-copy strong { color:var(--ink); }
    .destination { display:grid; gap:8px; padding:16px 18px; background:#f8fbfa; border:1px solid var(--line); border-radius:14px; }
    .destination-label { color:var(--muted); font-size:11px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; }
    .destination code { overflow-wrap:anywhere; color:var(--ink); font-family:"DM Sans",system-ui,sans-serif; font-size:14px; font-weight:700; }
    .permissions-panel { display:flex; flex-direction:column; justify-content:space-between; padding:42px; background:var(--mint); }
    .permissions-panel h2 { font-size:24px; }
    .permissions-intro { margin:10px 0 20px; color:var(--muted); font-size:14px; line-height:1.5; }
    .permission-list { display:grid; gap:11px; margin:0; padding:0; list-style:none; }
    .permission-list li { display:flex; align-items:flex-start; gap:10px; color:var(--ink); font-size:14px; line-height:1.4; }
    .permission-icon { display:grid; place-items:center; width:21px; height:21px; flex:0 0 auto; color:#063c22; background:var(--green); border-radius:50%; font-size:13px; font-weight:800; }
    .actions { display:grid; gap:10px; margin-top:34px; }
    .allow, .deny { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:48px; border-radius:999px; font-weight:800; }
    .allow { color:#063c22; background:var(--green); border:1px solid var(--green); box-shadow:0 8px 18px rgba(32,200,102,.18); }
    .allow:hover { background:#18b65b; }
    .deny { color:var(--ink); background:transparent; border:1px solid rgba(15,27,37,.17); }
    .deny:hover { background:rgba(255,255,255,.55); border-color:rgba(15,27,37,.3); }
    .privacy-note { display:flex; align-items:flex-start; gap:9px; max-width:710px; margin:24px auto 0; color:var(--muted); font-size:12px; line-height:1.5; text-align:center; }
    .privacy-note span:first-child { color:var(--green-deep); font-size:16px; line-height:1.1; }
    @media (max-width:760px) { .topbar { min-height:72px; padding:0 24px; } main { width:min(100% - 32px, 580px); padding:48px 0 56px; } .consent-card { grid-template-columns:1fr; } .request-panel, .permissions-panel { padding:30px 26px; } .permissions-panel { border-top:1px solid rgba(16,139,69,.12); } }
    @media (max-width:460px) { .topbar { padding:0 16px; } .brand { width:126px; } .secure-label { font-size:12px; } .secure-label span:last-child { display:none; } main { width:min(100% - 24px, 520px); padding-top:36px; } h1 { font-size:40px; } .request-panel, .permissions-panel { padding:25px 20px; } }
    @media (prefers-reduced-motion:reduce) { *, *::before, *::after { transition-duration:.01ms !important; } }
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <div class="brand" aria-label="WaPilot">${WAPILOT_LOGO_SVG}</div>
      <div class="secure-label"><span class="secure-dot" aria-hidden="true"></span><span>Conexão segura</span></div>
    </header>
    <main>
      <section class="intro" aria-labelledby="consent-title">
        <p class="eyebrow">Autorização de conexão</p>
        <h1 id="consent-title">Conecte seu WhatsApp ao WaPilot.</h1>
        <p class="lede">Revise o que este aplicativo poderá fazer antes de continuar. Você pode negar o acesso a qualquer momento.</p>
      </section>
      <section class="consent-card" aria-label="Detalhes da autorização">
        <div class="request-panel">
          <div class="request-mark" aria-hidden="true">↗</div>
          <h2>${esc(clientName)} quer se conectar</h2>
          <p class="request-copy">O aplicativo está solicitando acesso ao <strong>Evolution Go WhatsApp MCP</strong> para trabalhar com o número conectado ao seu workspace.</p>
          <div class="destination"><span class="destination-label">Resposta enviada para</span><code>${esc(redirectHost)}</code></div>
        </div>
        <div class="permissions-panel">
          <div>
            <h2>Permissões solicitadas</h2>
            <p class="permissions-intro">Essas permissões ficam vinculadas a esta conexão.</p>
            <ul class="permission-list">${requestedScopes}</ul>
          </div>
          <form class="actions" method="post" action="/authorize">
            <input type="hidden" name="handle" value="${esc(handle)}">
            <button class="allow" name="decision" value="allow" type="submit">Permitir conexão <span aria-hidden="true">→</span></button>
            <button class="deny" name="decision" value="deny" type="submit">Negar</button>
          </form>
        </div>
      </section>
      <p class="privacy-note"><span aria-hidden="true">●</span><span>O WaPilot usa esta autorização apenas para operar as permissões acima. Seus tokens não são exibidos nesta tela.</span></p>
    </main>
  </div>
</body>
</html>`;
}

