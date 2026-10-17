import type { AuthenticatedUser, ConnectionRecord, ConnectionSummary } from '../types';
import { decryptToken, encryptToken } from './crypto';

export async function ensureUser(db: D1Database, user: AuthenticatedUser): Promise<{ id: string; email: string }> {
  const existing = await db.prepare('SELECT id, email FROM users WHERE email = ?1').bind(user.email).first<{ id: string; email: string }>();
  if (existing) return existing;
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO users (id, email, status) VALUES (?1, ?2, \'active\')').bind(id, user.email).run();
  return { id, email: user.email };
}

export async function listConnections(db: D1Database, userId: string): Promise<ConnectionSummary[]> {
  const result = await db.prepare('SELECT id, friendly_name as friendlyName, instance_id as instanceId, phone_number as phoneNumber, is_default as isDefault, created_at as createdAt, updated_at as updatedAt FROM whatsapp_connections WHERE user_id = ?1 ORDER BY is_default DESC, friendly_name').bind(userId).all<ConnectionSummary>();
  return result.results ?? [];
}

export async function getConnection(db: D1Database, userId: string, connectionId: string): Promise<ConnectionRecord | null> {
  return db.prepare('SELECT id, user_id as userId, friendly_name as friendlyName, instance_id as instanceId, phone_number as phoneNumber, encrypted_token as encryptedToken, created_at as createdAt, updated_at as updatedAt FROM whatsapp_connections WHERE id = ?1 AND user_id = ?2').bind(connectionId, userId).first<ConnectionRecord>();
}

export async function getDefaultConnections(db: D1Database, userId: string): Promise<ConnectionRecord[]> {
  const result = await db.prepare('SELECT id, user_id as userId, friendly_name as friendlyName, instance_id as instanceId, phone_number as phoneNumber, encrypted_token as encryptedToken, created_at as createdAt, updated_at as updatedAt FROM whatsapp_connections WHERE user_id = ?1 AND is_default = 1 ORDER BY id').bind(userId).all<ConnectionRecord>();
  return result.results ?? [];
}

export const NO_DEFAULT_CONNECTION_ERROR = 'No default connection configured. Configure a default connection or pass a connection identifier';
export const MULTIPLE_DEFAULT_CONNECTIONS_ERROR = 'Multiple default connections configured';

export async function resolveConnection(db: D1Database, userId: string, connectionId?: string): Promise<ConnectionRecord> {
  if (connectionId) {
    const connection = await getConnection(db, userId, connectionId);
    if (!connection) throw new Error('Connection not found');
    return connection;
  }
  const defaults = await getDefaultConnections(db, userId);
  if (defaults.length === 0) throw new Error(NO_DEFAULT_CONNECTION_ERROR);
  if (defaults.length > 1) throw new Error(MULTIPLE_DEFAULT_CONNECTIONS_ERROR);
  return defaults[0];
}

export async function findConnectionByInstanceId(db: D1Database, userId: string, instanceId: string): Promise<ConnectionRecord | null> {
  return db.prepare('SELECT id, user_id as userId, friendly_name as friendlyName, instance_id as instanceId, phone_number as phoneNumber, encrypted_token as encryptedToken, created_at as createdAt, updated_at as updatedAt FROM whatsapp_connections WHERE instance_id = ?1 AND user_id = ?2').bind(instanceId, userId).first<ConnectionRecord>();
}

export async function findConnectionByFriendlyName(db: D1Database, userId: string, friendlyName: string): Promise<ConnectionRecord | null> {
  return db.prepare('SELECT id, user_id as userId, friendly_name as friendlyName, instance_id as instanceId, phone_number as phoneNumber, encrypted_token as encryptedToken, created_at as createdAt, updated_at as updatedAt FROM whatsapp_connections WHERE friendly_name = ?1 AND user_id = ?2 ORDER BY created_at ASC, id ASC LIMIT 1').bind(friendlyName, userId).first<ConnectionRecord>();
}

export async function createConnection(db: D1Database, encryptionKey: string, input: { userId: string; friendlyName: string; instanceId: string; phoneNumber?: string; token: string }): Promise<ConnectionSummary> {
  const id = crypto.randomUUID();
  const encryptedToken = await encryptToken(input.token, encryptionKey);
  const webhookSecret = randomSecret();
  const webhookSecretHash = await sha256(webhookSecret);
  const existing = await db.prepare('SELECT 1 as present FROM whatsapp_connections WHERE user_id = ?1 LIMIT 1').bind(input.userId).first<{ present: number }>();
  const isDefault = existing ? 0 : 1;
  await db.prepare('INSERT INTO whatsapp_connections (id, user_id, friendly_name, instance_id, phone_number, encrypted_token, webhook_secret_hash, is_default) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)').bind(id, input.userId, input.friendlyName, input.instanceId, input.phoneNumber ?? null, encryptedToken, webhookSecretHash, isDefault).run();
  return { id, friendlyName: input.friendlyName, instanceId: input.instanceId, phoneNumber: input.phoneNumber, isDefault: isDefault === 1, webhookSecret };
}

export async function setDefaultConnection(db: D1Database, userId: string, connectionId: string): Promise<boolean> {
  const target = await db.prepare('SELECT id FROM whatsapp_connections WHERE id = ?1 AND user_id = ?2').bind(connectionId, userId).first<{ id: string }>();
  if (!target) return false;
  await db.batch([
    db.prepare('UPDATE whatsapp_connections SET is_default = 0, updated_at = datetime(\'now\') WHERE user_id = ?1').bind(userId),
    db.prepare('UPDATE whatsapp_connections SET is_default = 1, updated_at = datetime(\'now\') WHERE id = ?1 AND user_id = ?2').bind(connectionId, userId),
  ]);
  return true;
}

export interface AuditSummary {
  operation: string;
  outcome: 'success' | 'failure';
  createdAt: string;
}

/** Read-only records used by the administrative operational snapshot. The
 * encrypted token is kept inside the server-side aggregation seam and is
 * never part of the returned snapshot. */
export interface AdminUserRecord {
  id: string;
  email: string;
  status: 'active' | 'disabled' | string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminConnectionRecord {
  id: string;
  userId: string;
  friendlyName: string;
  instanceId: string;
  phoneNumber?: string;
  encryptedToken: string;
  isDefault: number;
  createdAt: string;
  updatedAt: string;
}

export async function listAdminUsers(db: D1Database): Promise<AdminUserRecord[]> {
  const result = await db.prepare('SELECT id, email, status, created_at as createdAt, updated_at as updatedAt FROM users ORDER BY email, id').all<AdminUserRecord>();
  return result.results ?? [];
}

export async function listAdminConnections(db: D1Database): Promise<AdminConnectionRecord[]> {
  const result = await db.prepare('SELECT id, user_id as userId, friendly_name as friendlyName, instance_id as instanceId, phone_number as phoneNumber, encrypted_token as encryptedToken, is_default as isDefault, created_at as createdAt, updated_at as updatedAt FROM whatsapp_connections ORDER BY user_id, is_default DESC, friendly_name, id').all<AdminConnectionRecord>();
  return result.results ?? [];
}

export async function listAdminAudit(db: D1Database, userId: string, connectionId: string, limit = 3): Promise<AuditSummary[]> {
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 3);
  const result = await db.prepare('SELECT operation, outcome, created_at as createdAt FROM audit_log WHERE user_id = ?1 AND connection_id = ?2 ORDER BY created_at DESC, id DESC LIMIT ?3').bind(userId, connectionId, boundedLimit).all<AuditSummary>();
  return result.results ?? [];
}

export async function listRecentAudit(db: D1Database, userId: string, connectionId: string, limit = 3): Promise<AuditSummary[]> {
  const rows = await db.prepare('SELECT operation, outcome, created_at as createdAt FROM audit_log WHERE user_id = ?1 AND connection_id = ?2 ORDER BY created_at DESC LIMIT ?3').bind(userId, connectionId, Math.min(Math.max(limit, 1), 10)).all<AuditSummary>();
  return rows.results ?? [];
}

export async function updateConnection(db: D1Database, userId: string, connectionId: string, patch: { friendlyName?: string; phoneNumber?: string }): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.friendlyName !== undefined) { fields.push('friendly_name = ?'); values.push(patch.friendlyName); }
  if (patch.phoneNumber !== undefined) { fields.push('phone_number = ?'); values.push(patch.phoneNumber); }
  if (!fields.length) return;
  fields.push("updated_at = datetime('now')");
  values.push(connectionId, userId);
  await db.prepare(`UPDATE whatsapp_connections SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values).run();
}

export async function removeConnection(db: D1Database, userId: string, connectionId: string): Promise<boolean> {
  const target = await db.prepare('SELECT id, is_default as isDefault FROM whatsapp_connections WHERE id = ?1 AND user_id = ?2').bind(connectionId, userId).first<{ id: string; isDefault: number }>();
  if (!target) return false;

  const statements = [
    db.prepare('DELETE FROM whatsapp_connections WHERE id = ?1 AND user_id = ?2').bind(connectionId, userId),
  ];
  if (target.isDefault === 1) {
    const replacement = await db.prepare("SELECT id FROM whatsapp_connections WHERE user_id = ?1 AND id != ?2 ORDER BY created_at ASC, id ASC LIMIT 1").bind(userId, connectionId).first<{ id: string }>();
    if (replacement) {
      statements.push(db.prepare("UPDATE whatsapp_connections SET is_default = 1, updated_at = datetime('now') WHERE id = ?1 AND user_id = ?2").bind(replacement.id, userId));
    }
  }

  await db.batch(statements);
  return true;
}

export async function revealConnectionToken(db: D1Database, encryptionKey: string, connection: ConnectionRecord): Promise<string> {
  return decryptToken(connection.encryptedToken, encryptionKey);
}

export async function audit(db: D1Database, input: { userId: string; connectionId?: string; operation: string; outcome: 'success' | 'failure'; metadata?: Record<string, unknown> }): Promise<void> {
  await db.prepare('INSERT INTO audit_log (id, user_id, connection_id, operation, outcome, metadata_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(crypto.randomUUID(), input.userId, input.connectionId ?? null, input.operation, input.outcome, input.metadata ? JSON.stringify(input.metadata) : null).run();
}

export async function ingestWebhookEvent(db: D1Database, secret: string, payload: unknown): Promise<{ accepted: boolean; status: number; error?: string }> {
  const hash = await sha256(secret);
  const connection = await db.prepare('SELECT id, instance_id as instanceId FROM whatsapp_connections WHERE webhook_secret_hash = ?1').bind(hash).first<{ id: string; instanceId: string }>();
  if (!connection) return { accepted: false, status: 404, error: 'Unknown webhook' };
  const document = asRecord(payload);
  const jsonApiVersion = asRecord(document.jsonapi)?.version;
  if (jsonApiVersion !== '1.1' || 'errors' in document || !('data' in document)) return { accepted: false, status: 400, error: 'Invalid JSON:API document' };
  const meta = asRecord(document.meta);
  const eventName = typeof meta.event === 'string' && meta.event.trim() ? meta.event : undefined;
  const instanceId = typeof meta.instanceId === 'string' ? meta.instanceId : undefined;
  if (!eventName || !instanceId) return { accepted: false, status: 400, error: 'Webhook metadata is incomplete' };
  if (instanceId !== connection.instanceId) return { accepted: false, status: 400, error: 'Webhook instance mismatch' };

  const resources = Array.isArray(document.data) ? document.data : [document.data];
  if (resources.some((resource) => !isJsonApiResource(resource))) {
    return { accepted: false, status: 400, error: 'Invalid JSON:API data' };
  }
  const safeMeta = Object.fromEntries(Object.entries(meta).filter(([key]) => key !== 'instanceToken'));
  const statements = resources.map((resource) => {
    const item = resource as Record<string, unknown>;
    const resourceId = typeof item.id === 'string' && item.id.trim() ? item.id : undefined;
    const resourceMeta = asRecord(item.meta);
    const conversationId = typeof resourceMeta.chat === 'string' && resourceMeta.chat.trim() ? resourceMeta.chat : undefined;
    const safeDocument = { jsonapi: document.jsonapi, data: item, meta: safeMeta };
    return db.prepare('INSERT OR IGNORE INTO webhook_events (id, connection_id, event_name, message_id, conversation_id, message_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(crypto.randomUUID(), connection.id, eventName, resourceId ?? null, conversationId ?? null, JSON.stringify(safeDocument));
  });
  if (!statements.length) return { accepted: true, status: 202 };
  const results = await db.batch(statements);
  const inserted = results.reduce((count, result) => count + ((result.meta?.changes ?? 0) > 0 ? 1 : 0), 0);
  return { accepted: inserted > 0, status: inserted > 0 ? 202 : 200 };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isJsonApiResource(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const resource = value as Record<string, unknown>;
  return (resource.type === 'message' || resource.type === 'connection' || resource.type === 'chat')
    && typeof resource.id === 'string'
    && resource.id.trim().length > 0;
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
