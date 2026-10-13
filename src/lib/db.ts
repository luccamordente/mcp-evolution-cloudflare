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
  const result = await db.prepare('SELECT id, friendly_name as friendlyName, instance_id as instanceId, phone_number as phoneNumber, status FROM whatsapp_connections WHERE user_id = ?1 ORDER BY friendly_name').bind(userId).all<ConnectionSummary>();
  return result.results ?? [];
}

export async function getConnection(db: D1Database, userId: string, connectionId: string): Promise<ConnectionRecord | null> {
  return db.prepare('SELECT id, user_id as userId, friendly_name as friendlyName, instance_id as instanceId, phone_number as phoneNumber, encrypted_token as encryptedToken, status, created_at as createdAt, updated_at as updatedAt FROM whatsapp_connections WHERE id = ?1 AND user_id = ?2').bind(connectionId, userId).first<ConnectionRecord>();
}

export async function createConnection(db: D1Database, encryptionKey: string, input: { userId: string; friendlyName: string; instanceId: string; phoneNumber?: string; token: string }): Promise<ConnectionSummary> {
  const id = crypto.randomUUID();
  const encryptedToken = await encryptToken(input.token, encryptionKey);
  await db.prepare('INSERT INTO whatsapp_connections (id, user_id, friendly_name, instance_id, phone_number, encrypted_token, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, \'active\')').bind(id, input.userId, input.friendlyName, input.instanceId, input.phoneNumber ?? null, encryptedToken).run();
  return { id, friendlyName: input.friendlyName, instanceId: input.instanceId, phoneNumber: input.phoneNumber, status: 'active' };
}

export async function updateConnection(db: D1Database, userId: string, connectionId: string, patch: { friendlyName?: string; phoneNumber?: string; status?: ConnectionRecord['status'] }): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.friendlyName !== undefined) { fields.push('friendly_name = ?'); values.push(patch.friendlyName); }
  if (patch.phoneNumber !== undefined) { fields.push('phone_number = ?'); values.push(patch.phoneNumber); }
  if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
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
