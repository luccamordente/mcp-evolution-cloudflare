import type { AuthenticatedUser, ConnectionRecord, ConnectionSummary, Conversation, Message, Page } from '../types';
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
  const webhookSecret = randomSecret();
  const webhookSecretHash = await sha256(webhookSecret);
  await db.prepare('INSERT INTO whatsapp_connections (id, user_id, friendly_name, instance_id, phone_number, encrypted_token, webhook_secret_hash, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, \'active\')').bind(id, input.userId, input.friendlyName, input.instanceId, input.phoneNumber ?? null, encryptedToken, webhookSecretHash).run();
  return { id, friendlyName: input.friendlyName, instanceId: input.instanceId, phoneNumber: input.phoneNumber, status: 'active', webhookSecret };
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

export async function ingestWebhookEvent(db: D1Database, secret: string, payload: unknown): Promise<{ accepted: boolean; status: number; error?: string }> {
  const hash = await sha256(secret);
  const connection = await db.prepare('SELECT id, instance_id as instanceId FROM whatsapp_connections WHERE webhook_secret_hash = ?1 AND status = \'active\'').bind(hash).first<{ id: string; instanceId: string }>();
  if (!connection) return { accepted: false, status: 404, error: 'Unknown webhook' };
  const body = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const eventName = typeof body.event === 'string' ? body.event : 'Message';
  const data = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>;
  const info = (data.Info && typeof data.Info === 'object' ? data.Info : data.info && typeof data.info === 'object' ? data.info : {}) as Record<string, unknown>;
  const instanceId = String(body.instanceId ?? body.instanceID ?? data.instanceId ?? '');
  if (instanceId && instanceId !== connection.instanceId) return { accepted: false, status: 400, error: 'Webhook instance mismatch' };
  const message = (data.Message ?? data.message ?? data) as Record<string, unknown>;
  const messageId = String(info.ID ?? info.id ?? message.id ?? '');
  const conversationId = String(info.RemoteJID ?? info.remoteJid ?? info.Chat ?? info.chat ?? '');
  const safe = { info, message, groupData: data.groupData ?? data.group_data };
  const inserted = await db.prepare('INSERT OR IGNORE INTO webhook_events (id, connection_id, event_name, message_id, conversation_id, message_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(crypto.randomUUID(), connection.id, eventName, messageId || null, conversationId || null, JSON.stringify(safe)).run();
  return { accepted: (inserted.meta?.changes ?? 0) > 0, status: (inserted.meta?.changes ?? 0) > 0 ? 202 : 200 };
}

export async function listCapturedMessages(db: D1Database, userId: string, connectionId: string, options: { conversationId?: string; after?: string; before?: string; text?: string; cursor?: string; limit?: number } = {}): Promise<Page<Message>> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const offset = Number.parseInt(options.cursor ?? '0', 10) || 0;
  const where = ['c.user_id = ?1', 'e.connection_id = ?2'];
  const binds: unknown[] = [userId, connectionId];
  if (options.conversationId) { where.push('e.conversation_id = ?' + (binds.length + 1)); binds.push(options.conversationId); }
  if (options.after) { where.push('e.received_at >= ?' + (binds.length + 1)); binds.push(options.after); }
  if (options.before) { where.push('e.received_at <= ?' + (binds.length + 1)); binds.push(options.before); }
  if (options.text) { where.push('lower(e.message_json) LIKE ?' + (binds.length + 1)); binds.push('%' + options.text.toLowerCase() + '%'); }
  binds.push(limit + 1, offset);
  const rows = await db.prepare(`SELECT e.message_json as messageJson, e.received_at as receivedAt FROM webhook_events e JOIN whatsapp_connections c ON c.id = e.connection_id WHERE ${where.join(' AND ')} ORDER BY e.received_at DESC LIMIT ?${binds.length - 1} OFFSET ?${binds.length}`).bind(...binds).all<{ messageJson: string; receivedAt: string }>();
  const more = (rows.results ?? []).length > limit;
  const items = (rows.results ?? []).slice(0, limit).map((row) => normalizeCapturedMessage(row.messageJson, row.receivedAt));
  return { items, nextCursor: more ? String(offset + limit) : undefined, hasMore: more };
}

export async function listCapturedConversations(db: D1Database, userId: string, connectionId: string, cursor?: string, limit = 50): Promise<Page<Conversation>> {
  const offset = Number.parseInt(cursor ?? '0', 10) || 0;
  const rows = await db.prepare('SELECT e.conversation_id as conversationId, max(e.received_at) as lastMessageAt FROM webhook_events e JOIN whatsapp_connections c ON c.id = e.connection_id WHERE c.user_id = ?1 AND e.connection_id = ?2 AND e.conversation_id IS NOT NULL GROUP BY e.conversation_id ORDER BY lastMessageAt DESC LIMIT ?3 OFFSET ?4').bind(userId, connectionId, Math.min(Math.max(limit, 1), 100) + 1, offset).all<{ conversationId: string; lastMessageAt: string }>();
  const raw = rows.results ?? []; const more = raw.length > limit;
  return { items: raw.slice(0, limit).map((x) => ({ id: x.conversationId, jid: x.conversationId, lastMessageAt: x.lastMessageAt })), nextCursor: more ? String(offset + limit) : undefined, hasMore: more };
}

function normalizeCapturedMessage(json: string, receivedAt: string): Message {
  try {
    const value = JSON.parse(json) as { info?: Record<string, unknown>; message?: Record<string, unknown> };
    const info = value.info ?? {}; const message = value.message ?? {};
    const extended = message.extendedTextMessage && typeof message.extendedTextMessage === 'object' ? (message.extendedTextMessage as Record<string, unknown>).text : undefined;
    const text = String(message.conversation ?? message.text ?? extended ?? '');
    return { id: String(info.ID ?? info.id ?? ''), conversationId: String(info.RemoteJID ?? info.remoteJid ?? info.Chat ?? ''), jid: String(info.RemoteJID ?? info.remoteJid ?? ''), sender: String(info.Sender ?? info.sender ?? info.Participant ?? ''), direction: info.IsFromMe ? 'outbound' : 'inbound', timestamp: String(info.Timestamp ?? info.timestamp ?? receivedAt), type: String(info.Type ?? info.type ?? 'unknown'), text: text || undefined, raw: { info, message } };
  } catch { return { timestamp: receivedAt, direction: 'unknown' }; }
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
