import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../types';
import { evolutionState, extractPhone, type ConnectionViewState } from './connection-status';
import { EvolutionGoAdminClient } from './evolution';
import { decryptToken } from './crypto';
import {
  listAdminAudit,
  listAdminConnections,
  listAdminUsers,
  type AdminConnectionRecord,
  type AdminUserRecord,
  type AuditSummary,
} from './db';
import { summarizeGrant, type AuthorizationSummary } from './authorizations';

export const DEFAULT_ADMIN_EMAILS = ['luccamordente@gmail.com', 'heitorsalazar@gmail.com'] as const;

export type AdminAttentionReason = 'live_unavailable' | 'live_not_connected';

export interface AdminSourceFailure {
  source: 'evolution' | 'oauth' | 'audit';
  userId: string;
  connectionId?: string;
  message: string;
}

export interface AdminLiveStatus {
  available: boolean;
  state: ConnectionViewState | 'unavailable';
  checkedAt: string;
  phoneNumber?: string;
  error?: string;
}

export interface AdminConnectionSnapshot {
  id: string;
  friendlyName: string;
  instanceId: string;
  phoneNumber?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  live: AdminLiveStatus;
  activity: AuditSummary[];
  /** Audit reads can fail independently of the empty-audit state. */
  activityStatus: 'available' | 'unavailable';
  attention: boolean;
  attentionReasons: AdminAttentionReason[];
}

export interface AdminAuthorizationSnapshot {
  status: 'available' | 'unavailable';
  authorizations: AuthorizationSummary[];
  expiredCount: number;
  error?: string;
}

export interface AdminUserSnapshot {
  id: string;
  email: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  connections: AdminConnectionSnapshot[];
  authorizations: AdminAuthorizationSnapshot;
  attention: boolean;
}

export interface AdminSnapshotSummary {
  users: number;
  connections: number;
  connectedConnections: number;
  attentionUsers: number;
  attentionConnections: number;
  activeAuthorizations: number;
  expiredAuthorizations: number;
}

export interface AdminSnapshot {
  generatedAt: string;
  summary: AdminSnapshotSummary;
  users: AdminUserSnapshot[];
  sourceFailures: AdminSourceFailure[];
}

export interface AdminOAuthReader extends Pick<OAuthHelpers, 'listUserGrants' | 'lookupClient'> {}

export interface AdminSnapshotDependencies {
  now?: () => Date;
  oauth?: AdminOAuthReader;
  decryptToken?: (encryptedToken: string, encryptionKey: string) => Promise<string>;
  readLiveStatus?: (connection: AdminConnectionRecord, instanceToken: string) => Promise<unknown>;
}

/** The admin allowlist is independent from the broader Access allowlist. An
 * empty explicitly configured value denies administrative access. */
export function adminEmails(env: Pick<Env, 'ALLOWED_EMAILS'> & { ADMIN_EMAILS?: string }): Set<string> {
  const configured = env.ADMIN_EMAILS;
  const values = configured === undefined ? DEFAULT_ADMIN_EMAILS : configured.split(',');
  return new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));
}

export function isAdminOperator(email: string, env: Pick<Env, 'ALLOWED_EMAILS'> & { ADMIN_EMAILS?: string }): boolean {
  return adminEmails(env).has(email.trim().toLowerCase());
}

/**
 * Build the one server-side read-only operational snapshot used by `/admin`.
 * D1 is the inventory source; Evolution Go is queried once per connection for
 * live status; and OAuth grants are read once per user. Each secondary source
 * is isolated so one incident does not hide unrelated users or connections.
 */
export async function buildAdminSnapshot(env: Env, dependencies: AdminSnapshotDependencies = {}): Promise<AdminSnapshot> {
  const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const [users, connections] = await Promise.all([listAdminUsers(env.DB), listAdminConnections(env.DB)]);
  const failures: AdminSourceFailure[] = [];
  const byUser = new Map<string, AdminConnectionRecord[]>();
  for (const connection of connections) {
    const current = byUser.get(connection.userId) ?? [];
    current.push(connection);
    byUser.set(connection.userId, current);
  }

  const snapshots = await Promise.all(users.map(async (user) => {
    const userConnections = await Promise.all((byUser.get(user.id) ?? []).map(async (connection) => {
      const [liveResult, activityResult] = await Promise.all([
        readConnectionLive(env, connection, generatedAt, dependencies).catch((error) => ({ error })),
        listAdminAudit(env.DB, user.id, connection.id, 3).catch((error) => ({ error })),
      ]);

      const live = 'error' in liveResult
        ? unavailableLive(generatedAt)
        : liveResult;
      if ('error' in liveResult) {
        failures.push({ source: 'evolution', userId: user.id, connectionId: connection.id, message: safeSourceMessage(liveResult.error, 'Evolution Go indisponível') });
        live.error = 'Evolution Go indisponível';
      }

      const activity = 'error' in activityResult ? [] : activityResult;
      const activityStatus = 'error' in activityResult ? 'unavailable' : 'available';
      if ('error' in activityResult) failures.push({ source: 'audit', userId: user.id, connectionId: connection.id, message: safeSourceMessage(activityResult.error, 'Auditoria indisponível') });

      const attentionReasons = deriveAttentionReasons(live);
      return {
        id: connection.id,
        friendlyName: connection.friendlyName,
        instanceId: connection.instanceId,
        ...(connection.phoneNumber ? { phoneNumber: connection.phoneNumber } : {}),
        isDefault: connection.isDefault === 1,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
        live,
        activity,
        activityStatus,
        attention: attentionReasons.length > 0,
        attentionReasons,
      } satisfies AdminConnectionSnapshot;
    }));

    const authorizations = await readUserAuthorizations(user, dependencies.oauth, generatedAt).catch((error) => {
      failures.push({ source: 'oauth', userId: user.id, message: safeSourceMessage(error, 'OAuth Provider indisponível') });
      return { status: 'unavailable', authorizations: [], expiredCount: 0, error: 'OAuth Provider indisponível' } satisfies AdminAuthorizationSnapshot;
    });

    return {
      id: user.id,
      email: user.email,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      connections: userConnections,
      authorizations,
      attention: userConnections.some((connection) => connection.attention) || authorizations.status === 'unavailable',
    } satisfies AdminUserSnapshot;
  }));

  const summary = summarizeSnapshot(snapshots);
  return { generatedAt, summary, users: snapshots, sourceFailures: failures };
}

async function readConnectionLive(env: Env, connection: AdminConnectionRecord, checkedAt: string, dependencies: AdminSnapshotDependencies): Promise<AdminLiveStatus> {
  const decrypt = dependencies.decryptToken ?? decryptToken;
  const token = await decrypt(connection.encryptedToken, env.TOKEN_ENCRYPTION_KEY);
  const payload = dependencies.readLiveStatus
    ? await dependencies.readLiveStatus(connection, token)
    : await new EvolutionGoAdminClient({ baseUrl: env.EVOLUTION_BASE_URL, globalApiKey: env.EVOLUTION_GLOBAL_API_KEY ?? '' }).status(token);
  const state = evolutionState(payload);
  const phoneNumber = extractPhone(payload);
  return {
    available: true,
    state,
    checkedAt,
    ...(phoneNumber ? { phoneNumber } : {}),
  };
}

function unavailableLive(checkedAt: string): AdminLiveStatus {
  return { available: false, state: 'unavailable', checkedAt };
}

function deriveAttentionReasons(live: AdminLiveStatus): AdminAttentionReason[] {
  const reasons: AdminAttentionReason[] = [];
  if (!live.available) reasons.push('live_unavailable');
  else if (live.state !== 'connected') reasons.push('live_not_connected');
  return reasons;
}

async function readUserAuthorizations(user: AdminUserRecord, oauth: AdminOAuthReader | undefined, nowIso: string): Promise<AdminAuthorizationSnapshot> {
  if (!oauth) throw new Error('OAuth Provider indisponível');
  const now = Math.floor(Date.parse(nowIso) / 1000);
  const userId = encodeURIComponent(user.email);
  const active: AuthorizationSummary[] = [];
  let expiredCount = 0;
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  for (let page = 0; page < 100; page += 1) {
    const result = await oauth.listUserGrants(userId, { limit: 50, ...(cursor ? { cursor } : {}) });
    for (const grant of result.items ?? []) {
      if (typeof grant.expiresAt === 'number' && grant.expiresAt <= now) {
        expiredCount += 1;
      } else {
        active.push(await summarizeGrant(oauth, grant));
      }
    }
    const next = result.cursor;
    if (!next || seenCursors.has(next)) break;
    seenCursors.add(next);
    cursor = next;
  }
  return { status: 'available', authorizations: active, expiredCount };
}

function summarizeSnapshot(users: AdminUserSnapshot[]): AdminSnapshotSummary {
  const connections = users.flatMap((user) => user.connections);
  return {
    users: users.length,
    connections: connections.length,
    connectedConnections: connections.filter((connection) => connection.live.state === 'connected').length,
    attentionUsers: users.filter((user) => user.attention).length,
    attentionConnections: connections.filter((connection) => connection.attention).length,
    activeAuthorizations: users.reduce((count, user) => count + user.authorizations.authorizations.length, 0),
    expiredAuthorizations: users.reduce((count, user) => count + user.authorizations.expiredCount, 0),
  };
}

function safeSourceMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const safe = error.message
    .replace(/(authorization|bearer)\s*[:=]?\s*(?:bearer\s+)?[^\s,;]+/gi, '$1=[redacted]')
    .replace(/(token|api[-_ ]?key|password|secret|authorization|bearer)[=:]?\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[url redacted]')
    .slice(0, 180)
    .trim();
  return safe || fallback;
}
