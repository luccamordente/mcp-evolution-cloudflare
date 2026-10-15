export interface Env {
  DB: D1Database;
  OAUTH_KV?: KVNamespace;
  EVOLUTION_BASE_URL: string;
  EVOLUTION_GLOBAL_API_KEY?: string;
  TOKEN_ENCRYPTION_KEY: string;
  ACCESS_JWKS_URL?: string;
  ACCESS_ISSUER?: string;
  ACCESS_AUDIENCE?: string;
  CONSENT_SECRET?: string;
  ALLOWED_EMAILS?: string;
  ENVIRONMENT?: string;
  MAX_MEDIA_BYTES?: string;
  MCP_PUBLIC_URL?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
  claims: Record<string, unknown>;
}

export interface ConnectionRecord {
  id: string;
  userId: string;
  friendlyName: string;
  instanceId: string;
  phoneNumber?: string;
  encryptedToken: string;
  status: 'active' | 'disabled' | 'error';
  connectionState?: 'provisioning' | 'qr' | 'connected' | 'expired' | 'offline' | 'error';
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionSummary {
  id: string;
  friendlyName: string;
  instanceId: string;
  phoneNumber?: string;
  status: ConnectionRecord['status'];
  connectionState?: ConnectionRecord['connectionState'];
  isDefault?: boolean;
  createdAt?: string;
  updatedAt?: string;
  /** Returned only once by the local connection registration API. */
  webhookSecret?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface Contact {
  id?: string;
  jid?: string;
  name?: string;
  phoneNumber?: string;
  pushName?: string;
  avatarUrl?: string;
}

export interface Conversation {
  id?: string;
  jid?: string;
  name?: string;
  isGroup?: boolean;
  unreadCount?: number;
  lastMessageAt?: string;
}

export interface Group {
  id?: string;
  jid?: string;
  name?: string;
  owner?: string;
  participants?: Array<{ jid?: string; name?: string; isAdmin?: boolean }>;
  description?: string;
}

export interface Message {
  id?: string;
  conversationId?: string;
  jid?: string;
  sender?: string;
  recipient?: string;
  direction?: 'inbound' | 'outbound' | 'unknown';
  timestamp?: string;
  type?: string;
  text?: string;
  media?: { mimeType?: string; fileName?: string; size?: number; url?: string; mediaId?: string };
  raw?: unknown;
}

export interface SendMessageResult {
  messageId?: string;
  conversationId?: string;
  jid?: string;
  accepted: boolean;
  raw?: unknown;
}

export interface MediaDownload {
  mimeType: string;
  fileName?: string;
  size?: number;
  body: ReadableStream<Uint8Array>;
}
