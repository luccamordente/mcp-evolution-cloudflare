import { Hono } from 'hono';
import { authenticate, authResponse, AuthError, authenticateAccessRequest } from './lib/auth';
import { audit, createConnection, ensureUser, findConnectionByInstanceId, getConnection, listConnections, listRecentAudit, removeConnection, revealConnectionToken, setDefaultConnection, updateConnection, ingestWebhookEvent } from './lib/db';
import { EvolutionGoAdminClient, EvolutionApiError } from './lib/evolution';
import type { ConnectionSummary, Env } from './types';
import { connectionsPage } from './ui/connections';

type ProvisionInput = { ownerEmail: string; name: string; instanceId: string; phoneNumber?: string };
type ProvisionRequest = { instances?: Array<{ ownerEmail?: string; name?: string; instanceId?: string; phoneNumber?: string }> };

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
  if (c.req.query('provision') === '1' && user.email === 'luccamordente@gmail.com') {
    if (c.req.query('run') === '1') {
      try {
        const payload = await provisionEvolution(c.env, c.env.MCP_PUBLIC_URL ?? new URL(c.req.url).origin, [
          { ownerEmail: 'luccamordente@gmail.com', name: 'lucca', instanceId: 'ec547289-c781-498b-a904-412d5d133b13' },
          { ownerEmail: 'heitorsalazar@gmail.com', name: 'heitor', instanceId: 'c770126e-773a-408f-9405-89561d05447c' },
        ]);
        return c.html(adminProvisionResultPage(payload));
      } catch (error) {
        const cause = error instanceof EvolutionApiError && error.details && typeof error.details === 'object' && 'cause' in error.details ? String((error.details as { cause: unknown }).cause) : undefined;
        const details = error instanceof EvolutionApiError && error.details && !cause ? JSON.stringify(redactEvolutionSecrets(error.details)) : undefined;
        return c.html(adminProvisionErrorPage([error instanceof Error ? error.message : 'Provisioning failed', cause, details].filter(Boolean).join(': ')), 502);
      }
    }
    if (c.req.query('renew') === 'lucca') {
      try {
        const payload = await provisionEvolution(c.env, c.env.MCP_PUBLIC_URL ?? new URL(c.req.url).origin, [
          { ownerEmail: 'luccamordente@gmail.com', name: 'lucca', instanceId: 'ec547289-c781-498b-a904-412d5d133b13' },
        ], new Set(['ec547289-c781-498b-a904-412d5d133b13']));
        return c.html(adminProvisionResultPage(payload));
      } catch (error) {
        const cause = error instanceof EvolutionApiError && error.details && typeof error.details === 'object' && 'cause' in error.details ? String((error.details as { cause: unknown }).cause) : undefined;
        const details = error instanceof EvolutionApiError && error.details && !cause ? JSON.stringify(redactEvolutionSecrets(error.details)) : undefined;
        return c.html(adminProvisionErrorPage([error instanceof Error ? error.message : 'QR renewal failed', cause, details].filter(Boolean).join(': ')), 502);
      }
    }
    return c.html(adminProvisionPage());
  }
  return c.html(connectionsPage(auth));
});

// Keep the browser UI under the same path-scoped Access application as the
// page. Fetching /api from an Access-protected page can redirect to a second
// Access audience and browsers correctly reject that HTML redirect as CORS.
app.get('/connections/data', async (c) => {
  const auth = await requireUiAuth(c); if (auth instanceof Response) return auth;
  const user = await ensureUser(c.env.DB, auth);
  return c.json({ connections: await connectionViews(c.env, user.id, c.req.query('refresh') === '1') });
});

app.get('/api/connections', async (c) => {
  const auth = await requireUiAuth(c); if (auth instanceof Response) return auth;
  const user = await ensureUser(c.env.DB, auth);
  return c.json({ connections: await listConnections(c.env.DB, user.id) });
});

app.post('/api/connections/provision', async (c) => {
  const auth = await requireUiAuth(c); if (auth instanceof Response) return auth;
  try {
    const body = await c.req.json<{ friendlyName?: string; phoneNumber?: string }>().catch(() => ({}));
    return c.json(await provisionUserConnection(c.env, auth, body));
  } catch (error) {
    return c.json({ error: safeErrorMessage(error, 'Provisioning failed') }, error instanceof EvolutionApiError ? error.status >= 500 ? 502 : 400 : 502);
  }
});

app.post('/api/connections/:id/default', async (c) => {
  const auth = await requireUiAuth(c); if (auth instanceof Response) return auth;
  const user = await ensureUser(c.env.DB, auth);
  const changed = await setDefaultConnection(c.env.DB, user.id, c.req.param('id'));
  if (!changed) return c.json({ error: 'Connection not found' }, 404);
  await audit(c.env.DB, { userId: user.id, connectionId: c.req.param('id'), operation: 'connection_default', outcome: 'success' });
  return c.json({ ok: true });
});

app.get('/api/connections/:id/status', async (c) => {
  const auth = await requireUiAuth(c); if (auth instanceof Response) return auth;
  const user = await ensureUser(c.env.DB, auth);
  const connection = await getConnection(c.env.DB, user.id, c.req.param('id'));
  if (!connection) return c.json({ error: 'Connection not found' }, 404);
  try {
    const token = await revealConnectionToken(c.env.DB, c.env.TOKEN_ENCRYPTION_KEY, connection);
    const status = await new EvolutionGoAdminClient({ baseUrl: c.env.EVOLUTION_BASE_URL, globalApiKey: c.env.EVOLUTION_GLOBAL_API_KEY ?? '' }).status(token);
    const state = evolutionState(status);
    await updateConnection(c.env.DB, user.id, connection.id, { status: state === 'error' ? 'error' : 'active', connectionState: state });
    await audit(c.env.DB, { userId: user.id, connectionId: connection.id, operation: 'connection_status', outcome: 'success' });
    return c.json({ state, phoneNumber: extractPhone(status) ?? connection.phoneNumber });
  } catch (error) {
    await audit(c.env.DB, { userId: user.id, connectionId: connection.id, operation: 'connection_status', outcome: 'failure', metadata: { status: error instanceof EvolutionApiError ? error.status : 500, message: safeErrorMessage(error, 'unknown') } });
    return c.json({ error: safeErrorMessage(error, 'Could not check connection status') }, 502);
  }
});

app.post('/api/connections/:id/qr', async (c) => {
  const auth = await requireUiAuth(c); if (auth instanceof Response) return auth;
  const user = await ensureUser(c.env.DB, auth);
  const connection = await getConnection(c.env.DB, user.id, c.req.param('id'));
  if (!connection) return c.json({ error: 'Connection not found' }, 404);
  try {
    const token = await revealConnectionToken(c.env.DB, c.env.TOKEN_ENCRYPTION_KEY, connection);
    const admin = new EvolutionGoAdminClient({ baseUrl: c.env.EVOLUTION_BASE_URL, globalApiKey: c.env.EVOLUTION_GLOBAL_API_KEY ?? '' });
    await admin.reconnectInstance(token);
    const qr = await admin.qr(token);
    await updateConnection(c.env.DB, user.id, connection.id, { status: 'active', connectionState: 'qr' });
    await audit(c.env.DB, { userId: user.id, connectionId: connection.id, operation: 'connection_qr_refresh', outcome: 'success' });
    return c.json({ qr: qrDataUrl(qr), expiresIn: extractQrExpiry(qr) ?? 30 });
  } catch (error) {
    await audit(c.env.DB, { userId: user.id, connectionId: connection.id, operation: 'connection_qr_refresh', outcome: 'failure', metadata: { status: error instanceof EvolutionApiError ? error.status : 500, message: safeErrorMessage(error, 'unknown') } });
    return c.json({ error: safeErrorMessage(error, 'Could not renew QR code') }, 502);
  }
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

/** Owner-only bootstrap for the two human WhatsApp connections. This route
 * creates the Evolution Go instance, stores its token encrypted in D1, starts
 * the webhook connection, and returns only the QR payload (never credentials). */
app.post('/connections/provision', async (c) => {
  const auth = await requireUiAuth(c); if (auth instanceof Response) return auth;
  if (auth.email !== 'luccamordente@gmail.com') return c.json({ error: 'Admin access required' }, 403);
  const body = await c.req.json<ProvisionRequest>().catch((): ProvisionRequest => ({}));
  const requested = body.instances ?? [];
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > 2) return c.json({ error: 'Provide one or two instances' }, 400);
  const allowedOwners = new Set(['luccamordente@gmail.com', 'heitorsalazar@gmail.com']);
  const inputs = requested.map((item) => ({
    ownerEmail: item.ownerEmail?.trim().toLowerCase() ?? '',
    name: item.name?.trim() ?? '',
    instanceId: item.instanceId?.trim() || item.name?.trim() || '',
    phoneNumber: item.phoneNumber?.trim() || undefined,
  }));
  if (inputs.some((item) => !allowedOwners.has(item.ownerEmail) || !/^[a-z0-9_-]{1,64}$/i.test(item.name) || !/^[a-z0-9_-]{1,64}$/i.test(item.instanceId))) return c.json({ error: 'Each instance requires an allowed owner and an alphanumeric name/instanceId' }, 400);
  if (new Set(inputs.map((item) => item.ownerEmail)).size !== inputs.length || new Set(inputs.map((item) => item.instanceId)).size !== inputs.length) return c.json({ error: 'Owners and instance IDs must be unique in the request' }, 400);
  try { return c.json(await provisionEvolution(c.env, c.env.MCP_PUBLIC_URL ?? new URL(c.req.url).origin, inputs)); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Provisioning failed' }, 502); }
});

app.get('/admin/evolution', async (c) => {
  const auth = await requireUiAuth(c); if (auth instanceof Response) return auth;
  if (auth.email !== 'luccamordente@gmail.com') return c.text('Admin access required', 403);
  return c.html(adminProvisionPage());
});

type ConnectionViewState = 'connected' | 'provisioning' | 'qr' | 'expired' | 'offline' | 'error';

async function connectionViews(env: Env, userId: string, refresh: boolean): Promise<Array<ConnectionSummary & Record<string, unknown>>> {
  const connections = await listConnections(env.DB, userId);
  return Promise.all(connections.map(async (connection) => {
    const initialState = connection.connectionState ?? (connection.status === 'error' ? 'error' : connection.status === 'disabled' ? 'offline' : 'connected');
    const view: ConnectionSummary & Record<string, unknown> = {
      ...connection,
      isDefault: Boolean(connection.isDefault),
      state: initialState,
      statusDetail: undefined,
      lastVerified: connection.updatedAt ? formatRelativeTime(connection.updatedAt) : 'verificação pendente',
      health: initialState === 'connected' ? 'Saudável' : initialState === 'offline' ? 'Desconectada' : initialState === 'error' ? 'Indisponível' : 'Aguardando ação',
      healthDetail: initialState === 'connected' ? 'Recebendo e enviando normalmente' : 'A conexão precisa de atenção para continuar',
      uptime: initialState === 'connected' ? 'Disponível' : '—',
      uptimeDetail: connection.createdAt ? `Desde ${connection.createdAt}` : 'Após a confirmação',
      webhook: connection.status === 'error' ? 'Verificar' : 'Ativo',
      webhookDetail: connection.status === 'error' ? 'A resposta do provedor falhou' : 'Pronto para capturar eventos',
      activity: await activityFor(env.DB, userId, connection.id),
    };
    if (refresh && connection.status === 'active') {
      try {
        const record = await getConnection(env.DB, userId, connection.id);
        if (record) {
          const token = await revealConnectionToken(env.DB, env.TOKEN_ENCRYPTION_KEY, record);
          const result = await new EvolutionGoAdminClient({ baseUrl: env.EVOLUTION_BASE_URL, globalApiKey: env.EVOLUTION_GLOBAL_API_KEY ?? '' }).status(token);
          const state = evolutionState(result);
          await updateConnection(env.DB, userId, connection.id, { status: state === 'error' ? 'error' : 'active', connectionState: state });
          view.state = state;
          view.phoneNumber = extractPhone(result) ?? connection.phoneNumber;
          view.lastVerified = 'verificado agora';
          view.health = state === 'connected' ? 'Saudável' : state === 'offline' ? 'Desconectada' : state === 'error' ? 'Indisponível' : 'Aguardando ação';
          view.healthDetail = state === 'connected' ? 'Recebendo e enviando normalmente' : 'O provedor informou que esta conexão precisa de atenção';
        }
      } catch (error) {
        view.state = 'error';
        view.statusDetail = safeErrorMessage(error, 'Não foi possível verificar o provedor');
        view.health = 'Indisponível';
        view.healthDetail = 'Tente atualizar o estado da conexão';
      }
    }
    return view;
  }));
}

async function activityFor(db: D1Database, userId: string, connectionId: string): Promise<Array<{ icon: string; title: string; detail: string; time: string }>> {
  try {
    const rows = await listRecentAudit(db, userId, connectionId, 3);
    if (rows.length) return rows.map((row) => ({
      icon: row.outcome === 'success' ? '✓' : '!',
      title: auditTitle(row.operation),
      detail: row.outcome === 'success' ? 'Operação concluída com sucesso' : 'A operação precisa ser revisada',
      time: formatRelativeTime(row.createdAt),
    }));
  } catch (_) {
    // Older local databases may not have the audit table during development.
  }
  return [];
}

function auditTitle(operation: string): string {
  return ({ connection_create: 'Conexão cadastrada', connection_provision: 'Instância criada', connection_qr_refresh: 'QR Code renovado', connection_status: 'Conexão verificada', connection_default: 'Conexão padrão atualizada', connection_update: 'Conexão atualizada' } as Record<string, string>)[operation] ?? 'Atividade da conexão';
}

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z'));
  if (!Number.isFinite(timestamp)) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} d`;
}

async function provisionUserConnection(env: Env, user: { id: string; email: string; claims: Record<string, unknown> }, input: { friendlyName?: string; phoneNumber?: string }): Promise<Record<string, unknown>> {
  if (!env.EVOLUTION_GLOBAL_API_KEY) throw new Error('O provisionamento ainda não está configurado neste ambiente.');
  const name = input.friendlyName?.trim().slice(0, 64) || 'Novo WhatsApp';
  const instanceId = `wapilot-${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`;
  const token = randomInstanceToken();
  const admin = new EvolutionGoAdminClient({ baseUrl: env.EVOLUTION_BASE_URL, globalApiKey: env.EVOLUTION_GLOBAL_API_KEY });
  const owner = await ensureUser(env.DB, user);
  await admin.createInstance({ name, instanceId, token });
  let connection: ConnectionSummary | undefined;
  try {
    connection = await createConnection(env.DB, env.TOKEN_ENCRYPTION_KEY, { userId: owner.id, friendlyName: name, instanceId, phoneNumber: input.phoneNumber?.trim() || undefined, token, connectionState: 'qr' });
    const base = env.MCP_PUBLIC_URL ?? 'https://app.wapilot.com.br';
    await admin.connectInstance(token, { webhookUrl: connection.webhookSecret ? `${base}/webhooks/evolution/${connection.webhookSecret}` : undefined, subscribe: ['MESSAGE', 'SEND_MESSAGE', 'HISTORY_SYNC', 'GROUP', 'CONNECTION'], immediate: true });
    let qr: unknown;
    try { qr = await admin.qr(token); } catch (error) {
      if (error instanceof EvolutionApiError && error.status === 500) qr = undefined;
      else throw error;
    }
    await audit(env.DB, { userId: owner.id, connectionId: connection.id, operation: 'connection_provision', outcome: 'success' });
    return { connection, state: 'qr', qr: qrDataUrl(qr), expiresIn: extractQrExpiry(qr) ?? 30 };
  } catch (error) {
    if (connection) await updateConnection(env.DB, owner.id, connection.id, { status: 'error' });
    throw error;
  }
}

function evolutionState(payload: unknown): ConnectionViewState {
  const values: string[] = [];
  const visit = (value: unknown, key = '') => {
    if (typeof value === 'string' && /(state|status|connection|instance|qr|pair)/i.test(key)) values.push(value.toLowerCase());
    else if (Array.isArray(value)) value.forEach((item) => visit(item, key));
    else if (value && typeof value === 'object') Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(payload);
  const joined = values.join(' ');
  if (!joined) return 'error';
  if (/(qr|qrcode|pairing|scan)/.test(joined)) return 'qr';
  if (/(disconnect|offline|closed|logout|close)/.test(joined)) return 'offline';
  if (/(error|fail|unavailable)/.test(joined)) return 'error';
  if (/(creat|provision|pending|process)/.test(joined)) return 'provisioning';
  return 'connected';
}

function extractPhone(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ['phone', 'phoneNumber', 'number', 'ownerJid', 'jid']) {
    const value = record[key];
    if (typeof value === 'string' && value.replace(/\D/g, '').length >= 8) return value.replace(/@.*$/, '');
  }
  for (const value of Object.values(record)) { const found = extractPhone(value); if (found) return found; }
  return undefined;
}

function extractQrExpiry(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ['expiresIn', 'expires_in', 'ttl', 'timeout']) {
    const value = record[key];
    if (typeof value === 'number' && value > 0 && value < 3600) return Math.round(value);
    if (typeof value === 'string' && /^\d+$/.test(value)) return Math.min(3600, Number(value));
  }
  for (const value of Object.values(record)) { const found = extractQrExpiry(value); if (found) return found; }
  return undefined;
}

async function provisionEvolution(env: Env, base: string, inputs: ProvisionInput[], refreshInstanceIds = new Set<string>()): Promise<{ instances: Array<Record<string, unknown>> }> {
  if (!env.EVOLUTION_GLOBAL_API_KEY) throw new Error('Evolution administrative key is not configured');
  const admin = new EvolutionGoAdminClient({ baseUrl: env.EVOLUTION_BASE_URL, globalApiKey: env.EVOLUTION_GLOBAL_API_KEY });
  const results: Array<Record<string, unknown>> = [];
  for (const item of inputs) {
    const owner = await ensureUser(env.DB, { id: item.ownerEmail, email: item.ownerEmail, claims: {} });
    const existingConnection = await findConnectionByInstanceId(env.DB, owner.id, item.instanceId);
    let connection = existingConnection;
    let summary: ConnectionSummary;
    let token: string;
    let created = false;
    if (connection) {
      token = await revealConnectionToken(env.DB, env.TOKEN_ENCRYPTION_KEY, connection);
      summary = { id: connection.id, friendlyName: connection.friendlyName, instanceId: connection.instanceId, phoneNumber: connection.phoneNumber, status: connection.status };
      if (refreshInstanceIds.has(item.instanceId)) {
        await admin.reconnectInstance(token);
        await updateConnection(env.DB, owner.id, connection.id, { status: 'active', connectionState: 'qr' });
      }
    } else {
      token = randomInstanceToken();
      await admin.createInstance({ name: item.name, instanceId: item.instanceId, token });
      summary = await createConnection(env.DB, env.TOKEN_ENCRYPTION_KEY, { userId: owner.id, friendlyName: item.name, instanceId: item.instanceId, phoneNumber: item.phoneNumber, token, connectionState: 'qr' });
      created = true;
      await audit(env.DB, { userId: owner.id, connectionId: summary.id, operation: 'connection_provision', outcome: 'success' });
    }
    const webhookUrl = 'webhookSecret' in summary && summary.webhookSecret ? `${base}/webhooks/evolution/${summary.webhookSecret}` : undefined;
    if (webhookUrl) await admin.connectInstance(token, { webhookUrl, subscribe: ['MESSAGE', 'SEND_MESSAGE', 'HISTORY_SYNC', 'GROUP', 'CONNECTION'], immediate: true });
    let qr: unknown;
    try { qr = await admin.qr(token); } catch (error) {
      if (error instanceof EvolutionApiError && error.status === 500) qr = { status: 'not_available', message: error.message };
      else throw error;
    }
    results.push({ ownerEmail: item.ownerEmail, friendlyName: summary.friendlyName, instanceId: summary.instanceId, connectionId: summary.id, created, qr: redactEvolutionSecrets(qr) });
  }
  return { instances: results };
}

function adminProvisionResultPage(payload: { instances: Array<Record<string, unknown>> }): string {
  const cards = payload.instances.map((item) => {
    const qr = qrDataUrl(item.qr);
    const image = qr ? `<img alt="QR code ${escapeHtml(String(item.friendlyName ?? ''))}" width="360" src="${escapeHtml(qr)}"><p><a download="qr-${escapeHtml(String(item.friendlyName ?? 'instance'))}.png" href="${escapeHtml(qr)}">Baixar QR code</a></p>` : '<p>QR code ainda não disponível.</p>';
    return `<article><h2>${escapeHtml(String(item.friendlyName ?? ''))} · ${escapeHtml(String(item.instanceId ?? ''))}</h2><p>connectionId: ${escapeHtml(String(item.connectionId ?? ''))} · ${item.created ? 'criada agora' : 'já cadastrada'}</p>${image}</article>`;
  }).join('');
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>QR codes Evolution</title><body><main><h1>QR codes Evolution</h1><p>As conexões foram processadas no D1.</p>${cards}<p><a href="/connections">Voltar para conexões</a></p></main></body></html>`;
}

function adminProvisionErrorPage(message: string): string { return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Falha no provisionamento</title><body><main><h1>Falha no provisionamento</h1><p>${escapeHtml(message)}</p><p><a href="/connections?provision=1">Tentar novamente</a></p></main></body></html>`; }

function adminProvisionPage(): string { return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Provisionar Evolution</title><body><main><h1>Provisionar WhatsApp</h1><p>Cria as instâncias Lucca e Heitor, cadastra as conexões no D1 e solicita os QR codes.</p><button id="run">Criar/conferir instâncias</button><p><a href="/connections?provision=1&renew=lucca">Gerar novo QR da Lucca</a></p><p id="status"></p><section id="results"></section><script>
const status = document.getElementById('status'); const results = document.getElementById('results');
function findQr(value) { if (!value || typeof value !== 'object') return ''; if (Array.isArray(value)) { for (const item of value) { const found = findQr(item); if (found) return found; } return ''; } for (const [key, child] of Object.entries(value)) { if (/^(base64|qrcode|qr|code)$/i.test(key) && typeof child === 'string' && (child.startsWith('data:image/') || child.length > 100)) return child.startsWith('data:image/') ? child : 'data:image/png;base64,' + child; const found = findQr(child); if (found) return found; } return ''; }
 document.getElementById('run').onclick = () => { window.location.href = '/connections?provision=1&run=1'; };
</script></main></body></html>`; }

/** Evolution Go webhook ingress. The URL must contain the per-connection secret
 * configured by the connection UI; the payload's instance token is discarded. */
app.post('/webhooks/evolution/:secret', async (c) => {
  const result = await ingestWebhookEvent(c.env.DB, c.req.param('secret'), await c.req.json().catch(() => ({})));
  return result.accepted ? c.json({ ok: true }, 202) : c.json({ error: result.error }, result.status as 400 | 404 | 409);
});

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char)); }

function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return error.message
    .replace(/(token|api[-_ ]?key|password|secret)[=:]?\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 240) || fallback;
}

function randomInstanceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function qrDataUrl(value: unknown): string | undefined {
  if (typeof value === 'string') return value.startsWith('data:image/') ? value : value.length > 100 ? `data:image/png;base64,${value}` : undefined;
  if (Array.isArray(value)) { for (const item of value) { const found = qrDataUrl(item); if (found) return found; } return undefined; }
  if (!value || typeof value !== 'object') return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(base64|qrcode|qr|code)$/i.test(key)) { const found = qrDataUrl(child); if (found) return found; }
    const nested = qrDataUrl(child); if (nested) return nested;
  }
  return undefined;
}

function redactEvolutionSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactEvolutionSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !/(token|api.?key|password)/i.test(key)).map(([key, nested]) => [key, redactEvolutionSecrets(nested)]));
}

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((error, c) => { console.error('request failed', { path: c.req.path, message: error.message }); return c.json({ error: 'Internal server error' }, 500); });

export { app };

// The production OAuth wrapper lives in src/worker.ts so unit tests can import
// this Hono app without evaluating Cloudflare's `cloudflare:` runtime imports.
export default app;
