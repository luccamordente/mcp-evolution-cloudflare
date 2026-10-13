import { Hono } from 'hono';
import { authenticate, authResponse, AuthError, authenticateAccessRequest } from './lib/auth';
import { audit, createConnection, ensureUser, listConnections, removeConnection, updateConnection, ingestWebhookEvent } from './lib/db';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();
export const MCP_PROTOCOL_VERSION = '2026-07-28' as const;

app.get('/healthz', (c) => c.json({ ok: true, service: 'mcp-evolution-cloudflare', protocol: MCP_PROTOCOL_VERSION }));

async function requireAuth(c: any): Promise<{ info: import('@modelcontextprotocol/server').AuthInfo; user: import('./types').AuthenticatedUser } | Response> {
  try { return await authenticate(c.req.raw, c.env); } catch (error) { return authResponse(error instanceof AuthError ? error : new AuthError(500, 'Authentication failed')); }
}

/** Browser UI/API authentication is supplied by the path-scoped Cloudflare
 * Access application. MCP requests never use this helper; they are protected
 * by OAuthProvider in src/worker.ts. */
async function requireUiAuth(c: any): Promise<import('./types').AuthenticatedUser | Response> {
  try {
    return await authenticateAccessRequest(c.req.raw, c.env);
  } catch (accessError) {
    // Keep bearer access useful for API clients while preferring Access for the
    // browser. The Access assertion is never accepted at /mcp.
    if (c.req.header('authorization')) {
      try { return (await authenticate(c.req.raw, c.env)).user; } catch (oauthError) {
        return authResponse(oauthError instanceof AuthError ? oauthError : new AuthError(500, 'Authentication failed'));
      }
    }
    return authResponse(accessError instanceof AuthError ? accessError : new AuthError(500, 'Authentication failed'));
  }
}

app.get('/', (c) => c.html(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Evolution Go · MCP</title><body><main><h1>Evolution Go · MCP</h1><p>Interface protegida para cadastro local de conexões WhatsApp.</p><p>Use <code>/mcp</code> com OAuth 2.1/PKCE. A configuração completa exige autenticação Cloudflare Access.</p></main></body></html>`));

// The OAuth wrapper handles this route in production. Keeping a fail-closed
// fallback avoids accidentally exposing an unauthenticated Hono route in tests
// or if the wrapper is misconfigured.
app.all('/mcp', (c) => c.json({ error: 'OAuth 2.1 bearer token required' }, 401));

app.get('/connections', async (c) => {
  const auth = await requireUiAuth(c); if (auth instanceof Response) return auth;
  const user = await ensureUser(c.env.DB, auth);
  return c.html(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Conexões</title><body><main><h1>Minhas conexões</h1><p>Usuário: ${escapeHtml(user.email)}</p><p>Use a API autenticada <code>/api/connections</code> para cadastrar, validar e remover conexões. Remover só apaga o cadastro local.</p><pre id="connections">Carregando…</pre><script>fetch('/connections/data').then(r=>r.json()).then(x=>document.getElementById('connections').textContent=JSON.stringify(x,null,2)).catch(e=>document.getElementById('connections').textContent=e)</script></main></body></html>`);
});

// Keep the browser UI under the same path-scoped Access application as the
// page. Fetching /api from an Access-protected page can redirect to a second
// Access audience and browsers correctly reject that HTML redirect as CORS.
app.get('/connections/data', async (c) => {
  const auth = await requireUiAuth(c); if (auth instanceof Response) return auth;
  const user = await ensureUser(c.env.DB, auth);
  return c.json({ connections: await listConnections(c.env.DB, user.id) });
});

app.get('/api/connections', async (c) => {
  const auth = await requireUiAuth(c); if (auth instanceof Response) return auth;
  const user = await ensureUser(c.env.DB, auth);
  return c.json({ connections: await listConnections(c.env.DB, user.id) });
});

app.post('/api/connections', async (c) => {
  const auth = await requireUiAuth(c); if (auth instanceof Response) return auth;
  const body: { friendlyName?: string; instanceId?: string; phoneNumber?: string; instanceToken?: string } = await c.req.json().catch(() => ({}));
  if (!body.friendlyName || !body.instanceId || !body.instanceToken) return c.json({ error: 'friendlyName, instanceId and instanceToken are required' }, 400);
  const user = await ensureUser(c.env.DB, auth);
  const connection = await createConnection(c.env.DB, c.env.TOKEN_ENCRYPTION_KEY, { userId: user.id, friendlyName: body.friendlyName, instanceId: body.instanceId, phoneNumber: body.phoneNumber, token: body.instanceToken });
  await audit(c.env.DB, { userId: user.id, connectionId: connection.id, operation: 'connection_create', outcome: 'success' });
  const base = c.env.MCP_PUBLIC_URL ?? new URL(c.req.url).origin;
  return c.json({ connection, webhookUrl: `${base}/webhooks/evolution/${connection.webhookSecret}` }, 201);
});

app.patch('/api/connections/:id', async (c) => {
  const auth = await requireUiAuth(c); if (auth instanceof Response) return auth;
  const body = await c.req.json<{ friendlyName?: string; phoneNumber?: string; status?: 'active' | 'disabled' | 'error' }>().catch(() => ({}));
  const user = await ensureUser(c.env.DB, auth);
  await updateConnection(c.env.DB, user.id, c.req.param('id'), body);
  await audit(c.env.DB, { userId: user.id, connectionId: c.req.param('id'), operation: 'connection_update', outcome: 'success' });
  return c.json({ ok: true });
});

app.delete('/api/connections/:id', async (c) => {
  const auth = await requireUiAuth(c); if (auth instanceof Response) return auth;
  const user = await ensureUser(c.env.DB, auth);
  const removed = await removeConnection(c.env.DB, user.id, c.req.param('id'));
  await audit(c.env.DB, { userId: user.id, connectionId: c.req.param('id'), operation: 'connection_remove', outcome: removed ? 'success' : 'failure' });
  return removed ? c.body(null, 204) : c.json({ error: 'Connection not found' }, 404);
});

/** Evolution Go webhook ingress. The URL must contain the per-connection secret
 * configured by the connection UI; the payload's instance token is discarded. */
app.post('/webhooks/evolution/:secret', async (c) => {
  const result = await ingestWebhookEvent(c.env.DB, c.req.param('secret'), await c.req.json().catch(() => ({})));
  return result.accepted ? c.json({ ok: true }, 202) : c.json({ error: result.error }, result.status as 400 | 404 | 409);
});

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char)); }

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((error, c) => { console.error('request failed', { path: c.req.path, message: error.message }); return c.json({ error: 'Internal server error' }, 500); });

export { app };

// The production OAuth wrapper lives in src/worker.ts so unit tests can import
// this Hono app without evaluating Cloudflare's `cloudflare:` runtime imports.
export default app;
