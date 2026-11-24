import type { GrantSummary, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { authorizationClientName } from './authorizations';
import type { EventPrincipal } from './mcp-events';

const retention = 86_400_000;
const pageSize = 20;
type Cursor = { time: number; id: string };
type Scope = { userId: string; connectionId: string };
type SubscriptionRecord = EventPrincipal & {
  id: string;
  connectionId: string;
  eventName: 'message.received';
  conversationId: string | null;
  callbackUrl: string;
  activatedAt: number;
  expiresAt: number;
  state: 'active' | 'cancelled' | 'revoked';
};

export const isEventSubscriptionId = (id: string) => /^sub_[a-f0-9]{64}$/.test(id);

export function eventPageCursor(value: string | undefined): Cursor | undefined | null {
  if (value === undefined) return undefined;
  const match = /^(\d{1,16}):(sub_[a-f0-9]{64}|[a-f0-9-]{36})$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1]))) return null;
  return { time: Number(match[1]), id: match[2] };
}

export async function findEventGrants(oauth: Pick<OAuthHelpers, 'listUserGrants'>, subject: string, ids: string[]) {
  const outstanding = new Set(ids);
  const grants = new Map<string, GrantSummary>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  while (outstanding.size) {
    const page = await oauth.listUserGrants(subject, { limit: 100, ...(cursor ? { cursor } : {}) });
    for (const grant of page.items) {
      if (outstanding.delete(grant.id)) grants.set(grant.id, grant);
    }
    cursor = page.cursor;
    if (!cursor) break;
    if (seen.has(cursor)) throw new Error('Repeated authorization cursor');
    seen.add(cursor);
  }
  return grants;
}

export function matchesEventGrant(grant: GrantSummary, principal: EventPrincipal, now: number): boolean {
  return grant.id === principal.grantId && grant.userId === principal.providerUserId && grant.clientId === principal.clientId
    && grant.scope.includes('mcp:read')
    && (typeof grant.resource === 'string' ? grant.resource === principal.resource : Array.isArray(grant.resource) && grant.resource.includes(principal.resource))
    && (grant.expiresAt === undefined || (Number.isFinite(grant.expiresAt) && grant.expiresAt * 1000 > now));
}

export async function eventSubscriptionStopped(db: D1Database, userId: string, id: string): Promise<boolean> {
  return !!await db.prepare('SELECT 1 FROM event_subscription_stops WHERE subscription_id = ? AND user_id = ?').bind(id, userId).first();
}

export function cancelEventSubscriptionStatements(db: D1Database, userId: string, id: string, now: number, connectionId?: string): D1PreparedStatement[] {
  const owner = connectionId === undefined
    ? 'id = ? AND user_id = ?'
    : `id = ? AND user_id = ? AND connection_id = ?
      AND EXISTS (SELECT 1 FROM event_subscription_stops
        WHERE subscription_id = event_subscriptions.id AND user_id = event_subscriptions.user_id)`;
  const scope = connectionId === undefined ? [id, userId] : [id, userId, connectionId];
  const cancellable = connectionId === undefined ? "state != 'revoked'" : "state = 'active'";
  return [
    db.prepare(`UPDATE event_deliveries SET state = 'cancelled', body = NULL, lease_token = NULL, lease_until = NULL, result_code = 'cancelled'
      WHERE subscription_id IN (SELECT id FROM event_subscriptions WHERE ${owner}) AND state IN ('pending','delivering')`).bind(...scope),
    db.prepare(`UPDATE event_subscriptions SET state = 'cancelled', encrypted_secret = NULL, secret_hash = NULL,
      encrypted_previous_secret = NULL, previous_secret_until = NULL, verified_until = 0, expires_at = MIN(expires_at, ?), version = version + 1
      WHERE ${owner} AND ${cancellable}`).bind(now, ...scope),
  ];
}

export async function stopEventSubscription(db: D1Database, scope: Scope, id: string, now = Date.now()) {
  const { userId, connectionId } = scope;
  const [insert, , , stopped] = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO event_subscription_stops (subscription_id, user_id)
      SELECT s.id, s.user_id FROM event_subscriptions s JOIN users u ON u.id = s.user_id AND u.status = 'active'
      JOIN whatsapp_connections c ON c.id = s.connection_id AND c.user_id = s.user_id
      WHERE s.id = ? AND s.user_id = ? AND s.connection_id = ? AND s.state IN ('active','cancelled')
      AND s.activated_at IS NOT NULL AND s.expires_at > ?`).bind(id, userId, connectionId, now - retention),
    ...cancelEventSubscriptionStatements(db, userId, id, now, connectionId),
    db.prepare(`SELECT 1 FROM event_subscription_stops t JOIN event_subscriptions s ON s.id = t.subscription_id AND s.user_id = t.user_id
      JOIN users u ON u.id = s.user_id AND u.status = 'active'
      WHERE s.id = ? AND s.user_id = ? AND s.connection_id = ?`).bind(id, userId, connectionId),
  ]);
  return { stopped: stopped.results.length > 0, changed: insert.meta.changes > 0 };
}

const subscriptionProjection = `s.id, s.user_id AS userId, s.connection_id AS connectionId, s.callback_url AS callbackUrl,
  s.provider_user_id AS providerUserId, s.grant_id AS grantId, s.client_id AS clientId, s.resource, s.event_name AS eventName,
  s.conversation_id AS conversationId, s.activated_at AS activatedAt, s.expires_at AS expiresAt, s.state`;
const ownerJoins = `JOIN whatsapp_connections c ON c.id = s.connection_id AND c.user_id = s.user_id
  JOIN users u ON u.id = s.user_id AND u.status = 'active'`;
const visibleSubscriptions = `s.user_id = ?1 AND s.connection_id = ?2 AND s.expires_at > ?3
  AND s.activated_at IS NOT NULL AND s.state != 'pending'`;

export async function listEventSubscriptions(db: D1Database, scope: Scope, recent: boolean, cursor?: Cursor, now = Date.now()) {
  const group = recent ? "(s.state != 'active' OR s.expires_at <= ?7)" : "s.state = 'active' AND s.expires_at > ?7";
  const { results } = await db.prepare(`SELECT ${subscriptionProjection} FROM event_subscriptions s ${ownerJoins}
    WHERE ${visibleSubscriptions} AND ${group} AND (?4 IS NULL OR (s.expires_at, s.id) < (?4, ?5))
    ORDER BY s.expires_at DESC, s.id DESC LIMIT ?6`)
    .bind(scope.userId, scope.connectionId, now - retention, cursor?.time ?? null, cursor?.id ?? null, pageSize + 1, now).all<SubscriptionRecord>();
  const subscriptions = results.slice(0, pageSize);
  const last = subscriptions.at(-1);
  return { subscriptions, nextCursor: last && results.length > pageSize ? last.expiresAt + ':' + last.id : undefined };
}

export async function getEventSubscription(db: D1Database, scope: Scope, id: string, now = Date.now()) {
  return db.prepare(`SELECT ${subscriptionProjection} FROM event_subscriptions s ${ownerJoins} WHERE ${visibleSubscriptions} AND s.id = ?4`)
    .bind(scope.userId, scope.connectionId, now - retention, id).first<SubscriptionRecord>();
}

export async function describeEventSubscriptions(rows: SubscriptionRecord[], oauth: Pick<OAuthHelpers, 'lookupClient' | 'listUserGrants'> | undefined, subject: string, now: number) {
  const clients = new Map<string, string | undefined>();
  const grantIds = rows.filter(row => row.state === 'active' && row.expiresAt > now).map(row => row.grantId);
  const grants = await (oauth && findEventGrants(oauth, subject, grantIds).catch(() => undefined));
  if (oauth) {
    const ids = [...new Set(rows.map(row => row.clientId))];
    // Leave room for other concurrent work when resolving remote client metadata.
    for (let i = 0; i < ids.length; i += 4) {
      await Promise.all(ids.slice(i, i + 4).map(async id => clients.set(id, await authorizationClientName(oauth, id))));
    }
  }
  return rows.map(row => {
    const grant = grants?.get(row.grantId);
    const state = row.state !== 'active' ? row.state : row.expiresAt <= now ? 'expired' : 'active';
    const authorization = state !== 'active' ? undefined : grants === undefined ? 'unavailable'
      : grant && matchesEventGrant(grant, row, now) ? 'valid' : 'inactive';
    return {
      id: row.id, appName: clients.get(row.clientId) ?? 'Aplicativo não identificado', authorizationId: row.grantId,
      callbackUrl: row.callbackUrl, eventName: row.eventName, conversationId: row.conversationId,
      activatedAt: new Date(row.activatedAt).toISOString(),
      ...(state === 'active' ? { expiresAt: new Date(row.expiresAt).toISOString() } : { endedAt: new Date(row.expiresAt).toISOString() }),
      state, authorization,
    };
  });
}

type DeliveryRecord = {
  id: string;
  messageId: string | null;
  receivedAt: number;
  state: string;
  attempts: number;
  result: string | null;
};

export async function listEventSubscriptionDeliveries(db: D1Database, scope: Scope, id: string, cursor?: Cursor, now = Date.now()) {
  const { results } = await db.prepare(`SELECT d.id, m.message_id AS messageId, d.received_at AS receivedAt, d.state, d.attempts, d.result_code AS result
    FROM event_subscriptions s ${ownerJoins} JOIN event_deliveries d ON d.subscription_id = s.id
    LEFT JOIN event_sources m ON m.id = d.source_id AND m.connection_id = s.connection_id AND m.expires_at > ?5
    WHERE ${visibleSubscriptions} AND s.id = ?4 AND d.expires_at > ?5 AND (?6 IS NULL OR (d.received_at, d.id) < (?6, ?7))
    ORDER BY d.received_at DESC, d.id DESC LIMIT ?8`)
    .bind(scope.userId, scope.connectionId, now - retention, id, now, cursor?.time ?? null, cursor?.id ?? null, pageSize + 1).all<DeliveryRecord>();
  const deliveries = results.slice(0, pageSize);
  const last = deliveries.at(-1);
  return {
    deliveries: deliveries.map(({ id: _, ...row }) => ({
      ...row,
      receivedAt: new Date(row.receivedAt).toISOString(),
      result: row.result && /^(http_[1-5]\d{2}|http_2xx|deadline|attempt_limit|authorization|cancelled|unavailable|lease_expired|expired_or_invalid|sender_destination_blocked|sender_invalid_request)$/.test(row.result) ? row.result : null,
    })),
    nextCursor: last && results.length > pageSize ? last.receivedAt + ':' + last.id : undefined,
  };
}
