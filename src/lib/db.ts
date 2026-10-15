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
  return db.prepare('SELECT id, user_id as userId, friendly_name as friendlyName, instance_id as instanceId, phone_number as phoneNumber, encrypted_token as encryptedToken, status, connection_state as connectionState, created_at as createdAt, updated_at as updatedAt FROM whatsapp_connections WHERE id = ?1 AND user_id = ?2').bind(connectionId, userId).first<ConnectionRecord>();
}

export async function findConnectionByInstanceId(db: D1Database, userId: string, instanceId: string): Promise<ConnectionRecord | null> {
  return db.prepare('SELECT id, user_id as userId, friendly_name as friendlyName, instance_id as instanceId, phone_number as phoneNumber, encrypted_token as encryptedToken, status, connection_state as connectionState, created_at as createdAt, updated_at as updatedAt FROM whatsapp_connections WHERE instance_id = ?1 AND user_id = ?2').bind(instanceId, userId).first<ConnectionRecord>();
}

export async function createConnection(db: D1Database, encryptionKey: string, input: { userId: string; friendlyName: string; instanceId: string; phoneNumber?: string; token: string; connectionState?: ConnectionRecord['connectionState'] }): Promise<ConnectionSummary> {
  const id = crypto.randomUUID();
  const encryptedToken = await encryptToken(input.token, encryptionKey);
  const webhookSecret = randomSecret();
  const webhookSecretHash = await sha256(webhookSecret);
  const existing = await db.prepare('SELECT 1 as present FROM whatsapp_connections WHERE user_id = ?1 LIMIT 1').bind(input.userId).first<{ present: number }>();
  const isDefault = existing ? 0 : 1;
  const connectionState = input.connectionState ?? 'connected';
  await db.prepare('INSERT INTO whatsapp_connections (id, user_id, friendly_name, instance_id, phone_number, encrypted_token, webhook_secret_hash, status, connection_state, is_default) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, \'active\', ?8, ?9)').bind(id, input.userId, input.friendlyName, input.instanceId, input.phoneNumber ?? null, encryptedToken, webhookSecretHash, connectionState, isDefault).run();
  return { id, friendlyName: input.friendlyName, instanceId: input.instanceId, phoneNumber: input.phoneNumber, status: 'active', connectionState, isDefault: isDefault === 1, webhookSecret };
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

export async function listRecentAudit(db: D1Database, userId: string, connectionId: string, limit = 3): Promise<AuditSummary[]> {
  const rows = await db.prepare('SELECT operation, outcome, created_at as createdAt FROM audit_log WHERE user_id = ?1 AND connection_id = ?2 ORDER BY created_at DESC LIMIT ?3').bind(userId, connectionId, Math.min(Math.max(limit, 1), 10)).all<AuditSummary>();
  return rows.results ?? [];
}

export async function updateConnection(db: D1Database, userId: string, connectionId: string, patch: { friendlyName?: string; phoneNumber?: string; status?: ConnectionRecord['status']; connectionState?: ConnectionRecord['connectionState'] }): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.friendlyName !== undefined) { fields.push('friendly_name = ?'); values.push(patch.friendlyName); }
  if (patch.phoneNumber !== undefined) { fields.push('phone_number = ?'); values.push(patch.phoneNumber); }
  if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
  if (patch.connectionState !== undefined) { fields.push('connection_state = ?'); values.push(patch.connectionState); }
  if (!fields.length) return;
  fields.push("updated_at = datetime('now')");
  values.push(connectionId, userId);
  await db.prepare(`UPDATE whatsapp_connections SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values).run();
}

export async function removeConnection(db: D1Database, userId: string, connectionId: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM whatsapp_connections WHERE id = ?1 AND user_id = ?2').bind(connectionId, userId).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function revealConnectionToken(db: D1Database, encryptionKey: string, connection: ConnectionRecord): Promise<string> {
  return decryptToken(connection.encryptedToken, encryptionKey);
}

export async function audit(db: D1Database, input: { userId: string; connectionId?: string; operation: string; outcome: 'success' | 'failure'; metadata?: Record<string, unknown> }): Promise<void> {
  await db.prepare('INSERT INTO audit_log (id, user_id, connection_id, operation, outcome, metadata_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(crypto.randomUUID(), input.userId, input.connectionId ?? null, input.operation, input.outcome, input.metadata ? JSON.stringify(input.metadata) : null).run();
}

export async function ingestWebhookEvent(db: D1Database, secret: string, payload: unknown): Promise<{ accepted: boolean; status: number; error?: string }> {
  const hash = await sha256(secret);
  const connection = await db.prepare('SELECT id, instance_id as instanceId FROM whatsapp_connections WHERE webhook_secret_hash = ?1 AND status = \'active\'').bind(hash).first<{ id: string; instanceId: string }>();
  if (!connection) return { accepted: false, status: 404, error: 'Unknown webhook' };
  const body = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const eventName = typeof body.event === 'string' ? body.event : 'Message';
  const data = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>;
  const info = (data.Info && typeof data.Info === 'object' ? data.Info : data.info && typeof data.info === 'object' ? data.info : {}) as Record<string, unknown>;
  const key = (data.key && typeof data.key === 'object' ? data.key : data.Key && typeof data.Key === 'object' ? data.Key : {}) as Record<string, unknown>;
  const instanceId = String(body.instanceId ?? body.instanceID ?? data.instanceId ?? '');
  if (instanceId && instanceId !== connection.instanceId) return { accepted: false, status: 400, error: 'Webhook instance mismatch' };
  const message = (data.Message && typeof data.Message === 'object' ? data.Message : data.message && typeof data.message === 'object' ? data.message : data) as Record<string, unknown>;
  const messageId = String(info.ID ?? info.id ?? key.ID ?? key.id ?? message.id ?? '');
  const conversationId = String(info.RemoteJID ?? info.remoteJid ?? info.Chat ?? info.chat ?? key.remoteJid ?? key.remoteJID ?? '');
  const safe = { info, message, groupData: data.groupData ?? data.group_data };
  const inserted = await db.prepare('INSERT OR IGNORE INTO webhook_events (id, connection_id, event_name, message_id, conversation_id, message_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(crypto.randomUUID(), connection.id, eventName, messageId || null, conversationId || null, JSON.stringify(safe)).run();
  return { accepted: (inserted.meta?.changes ?? 0) > 0, status: (inserted.meta?.changes ?? 0) > 0 ? 202 : 200 };
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
