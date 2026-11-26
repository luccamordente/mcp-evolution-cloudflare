import { z } from 'zod';
import type { Env } from '../types';
import { encryptToken } from './crypto';

type Scope = { userId: string; connectionId: string };
type SaveDestination = Scope & {
  grantId: string;
  grantExpiresAt?: number;
  label: string;
  url: string;
  key: string;
  conversationIds: string[];
};

export class WebhookDestinationError extends Error {}

export function canonicalWebhookConversation(value: string): string {
  const id = value.trim();
  return /^(\d+)(?::\d+)?@s\.whatsapp\.net$/.exec(id)?.[1] ?? id;
}

export function isNativeWebhookClient(env: Env, clientId: string): boolean {
  const configured = env.WEBHOOK_NATIVE_CLIENT_IDS;
  if (!configured) return false;
  try {
    return z.array(z.string()).parse(JSON.parse(configured)).includes(clientId);
  } catch {
    return true;
  }
}

function routineUrl(input: string, hostname: string | undefined): URL {
  const candidate = z.url().safeParse(input);
  if (candidate.success && input.length <= 2048 && !/[?#]/.test(input)) {
    const url = new URL(candidate.data);
    if (url.protocol === 'https:' && url.hostname === hostname && !url.port && !url.username && !url.password
      && !url.search && !url.hash && /^\/automations\/webhook\/[A-Za-z0-9_-]{1,200}$/.test(url.pathname)) return url;
  }
  throw new WebhookDestinationError('Informe a URL HTTPS de uma rotina compatível.');
}

async function encryptedKey(env: Env, key: string): Promise<string> {
  if (!/^[A-Za-z0-9._~+/-]{1,1024}={0,2}$/.test(key)) throw new WebhookDestinationError('Informe uma chave de webhook válida.');
  return encryptToken(key, env.TOKEN_ENCRYPTION_KEY);
}

type PublicRow = { id: string; label: string; hostname: string; grantId: string; conversationIds: string; state: 'active' | 'disabled' };

function describe(row: PublicRow) {
  return {
    id: row.id, label: row.label, hostname: row.hostname, grantId: row.grantId,
    conversationIds: z.array(z.string()).parse(JSON.parse(row.conversationIds)), state: row.state,
  };
}

const destinationSummary = `id, label, hostname, grant_id AS grantId, conversation_ids AS conversationIds,
  CASE WHEN encrypted_key IS NULL OR grant_expires_at <= ? THEN 'disabled' ELSE 'active' END AS state`;

export async function listWebhookDestinations(env: Env, { userId, connectionId }: Scope) {
  const rows = await env.DB.prepare(`SELECT ${destinationSummary} FROM webhook_destinations
    WHERE user_id = ? AND connection_id = ? ORDER BY label, id`).bind(Date.now(), userId, connectionId).all<PublicRow>();
  return rows.results.map(describe);
}

export async function saveWebhookDestination(env: Env, input: SaveDestination) {
  const url = routineUrl(input.url, env.WEBHOOK_ROUTINE_HOST);
  const label = input.label.trim();
  const conversations = [...new Set(input.conversationIds.map(canonicalWebhookConversation))];
  if (!label || label.length > 80 || !conversations.length || conversations.length > 50
    || conversations.some(id => !/^(?:\d+|\d+(?::\d+)?@lid|\d+(?:-\d+)?@g\.us)$/.test(id) || id.length > 200)) {
    throw new WebhookDestinationError('Informe um nome e conversas válidas para o destino.');
  }
  const now = Date.now();
  const key = await encryptedKey(env, input.key);
  const row = await env.DB.prepare(`INSERT INTO webhook_destinations
    (id,user_id,connection_id,grant_id,label,url,hostname,conversation_ids,encrypted_key,grant_expires_at)
    SELECT ?,u.id,c.id,?,?,?,?,?,?,? FROM users u JOIN whatsapp_connections c ON c.user_id = u.id
    WHERE u.id = ? AND u.status = 'active' AND c.id = ?
    AND NOT EXISTS (SELECT 1 FROM event_grant_revocations r WHERE r.user_id = u.id AND r.grant_id = ? AND r.expires_at > ?)
    RETURNING ${destinationSummary}`).bind(crypto.randomUUID(), input.grantId, label, url.href, url.hostname,
      JSON.stringify(conversations), key, input.grantExpiresAt ?? null, input.userId, input.connectionId, input.grantId, now, now).first<PublicRow>();
  if (!row) throw new WebhookDestinationError('Esta autorização não está disponível.');
  return describe(row);
}

export async function changeWebhookDestination(env: Env, scope: Scope & { destinationId: string },
  action: { operation: 'rotate'; key: string } | { operation: 'disable' }): Promise<boolean> {
  const key = action.operation === 'rotate' ? await encryptedKey(env, action.key) : null;
  const now = Date.now();
  const result = await env.DB.prepare(`UPDATE webhook_destinations SET encrypted_key = ?, version = version + 1
    WHERE id = ? AND user_id = ? AND connection_id = ? AND encrypted_key IS NOT NULL
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = webhook_destinations.user_id AND u.status = 'active')
    AND (? IS NULL OR grant_expires_at IS NULL OR grant_expires_at > ?)
    AND NOT EXISTS (SELECT 1 FROM event_grant_revocations r WHERE r.user_id = webhook_destinations.user_id
      AND r.grant_id = webhook_destinations.grant_id AND r.expires_at > ?)`)
    .bind(key, scope.destinationId, scope.userId, scope.connectionId, key, now, now).run();
  return result.meta.changes > 0;
}
