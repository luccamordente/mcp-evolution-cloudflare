import { Hono } from 'hono';
import { createMcpHandler, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server';
import { authenticate, authResponse, AuthError } from './lib/auth';
import { audit, createConnection, ensureUser, listConnections, removeConnection, updateConnection } from './lib/db';
import { createMcpServer } from './lib/mcp';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.json({ ok: true, service: 'mcp-evolution-cloudflare', protocol: LATEST_PROTOCOL_VERSION }));

function metadata(c: any) {
  const base = c.env.MCP_PUBLIC_URL ?? new URL(c.req.url).origin;
  return c.json({ resource: `${base}/mcp`, authorization_servers: [c.env.ACCESS_ISSUER ?? `${base}/oauth`], scopes_supported: ['mcp'] }, 200, { 'Cache-Control': 'public, max-age=300' });
}
app.get('/.well-known/oauth-protected-resource', metadata);
app.get('/.well-known/oauth-authorization-server', (c) => c.json({ issuer: c.env.ACCESS_ISSUER ?? `${new URL(c.req.url).origin}/oauth`, authorization_endpoint: `${c.env.ACCESS_ISSUER ?? `${new URL(c.req.url).origin}/oauth`}/authorize`, token_endpoint: `${c.env.ACCESS_ISSUER ?? `${new URL(c.req.url).origin}/oauth`}/token`, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], scopes_supported: ['mcp'] }, 200, { 'Cache-Control': 'public, max-age=300' }));

async function requireAuth(c: any): Promise<{ info: import('@modelcontextprotocol/server').AuthInfo; user: import('./types').AuthenticatedUser } | Response> {
  try { return await authenticate(c.req.raw, c.env); } catch (error) { return authResponse(error instanceof AuthError ? error : new AuthError(500, 'Authentication failed')); }
}

app.all('/mcp', async (c) => {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;
  const handler = createMcpHandler(() => createMcpServer(c.env, auth.user), { legacy: 'reject', responseMode: 'json', maxRequestBodySize: Number(c.env.MAX_MEDIA_BYTES ?? 8 * 1024 * 1024), onerror: () => undefined });
  return handler.fetch(c.req.raw, { authInfo: auth.info });
});

app.get('/', (c) => c.html(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Evolution Go · MCP</title><body><main><h1>Evolution Go · MCP</h1><p>Interface protegida para cadastro local de conexões WhatsApp.</p><p>Use <code>/mcp</code> com OAuth 2.1/PKCE. A configuração completa exige autenticação Cloudflare Access.</p></main></body></html>`));

app.get('/connections', async (c) => {
  const auth = await requireAuth(c); if (auth instanceof Response) return auth;
  const user = await ensureUser(c.env.DB, auth.user);
  return c.html(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Conexões</title><body><main><h1>Minhas conexões</h1><p>Usuário: ${escapeHtml(user.email)}</p><p>Use a API autenticada <code>/api/connections</code> para cadastrar, validar e remover conexões. Remover só apaga o cadastro local.</p><pre id="connections">Carregando…</pre><script>fetch('/api/connections').then(r=>r.json()).then(x=>document.getElementById('connections').textContent=JSON.stringify(x,null,2)).catch(e=>document.getElementById('connections').textContent=e)</script></main></body></html>`);
});

app.get('/api/connections', async (c) => {
  const auth = await requireAuth(c); if (auth instanceof Response) return auth;
  const user = await ensureUser(c.env.DB, auth.user);
  return c.json({ connections: await listConnections(c.env.DB, user.id) });
});

app.post('/api/connections', async (c) => {
  const auth = await requireAuth(c); if (auth instanceof Response) return auth;
  const body: { friendlyName?: string; instanceId?: string; phoneNumber?: string; instanceToken?: string } = await c.req.json().catch(() => ({}));
  if (!body.friendlyName || !body.instanceId || !body.instanceToken) return c.json({ error: 'friendlyName, instanceId and instanceToken are required' }, 400);
  const user = await ensureUser(c.env.DB, auth.user);
  const connection = await createConnection(c.env.DB, c.env.TOKEN_ENCRYPTION_KEY, { userId: user.id, friendlyName: body.friendlyName, instanceId: body.instanceId, phoneNumber: body.phoneNumber, token: body.instanceToken });
  await audit(c.env.DB, { userId: user.id, connectionId: connection.id, operation: 'connection_create', outcome: 'success' });
  return c.json({ connection }, 201);
});

app.patch('/api/connections/:id', async (c) => {
  const auth = await requireAuth(c); if (auth instanceof Response) return auth;
  const body = await c.req.json<{ friendlyName?: string; phoneNumber?: string; status?: 'active' | 'disabled' | 'error' }>().catch(() => ({}));
  const user = await ensureUser(c.env.DB, auth.user);
  await updateConnection(c.env.DB, user.id, c.req.param('id'), body);
  await audit(c.env.DB, { userId: user.id, connectionId: c.req.param('id'), operation: 'connection_update', outcome: 'success' });
  return c.json({ ok: true });
});

app.delete('/api/connections/:id', async (c) => {
  const auth = await requireAuth(c); if (auth instanceof Response) return auth;
  const user = await ensureUser(c.env.DB, auth.user);
  const removed = await removeConnection(c.env.DB, user.id, c.req.param('id'));
  await audit(c.env.DB, { userId: user.id, connectionId: c.req.param('id'), operation: 'connection_remove', outcome: removed ? 'success' : 'failure' });
  return removed ? c.body(null, 204) : c.json({ error: 'Connection not found' }, 404);
});

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char)); }

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((error, c) => { console.error('request failed', { path: c.req.path, message: error.message }); return c.json({ error: 'Internal server error' }, 500); });

export default app;
export { app };
