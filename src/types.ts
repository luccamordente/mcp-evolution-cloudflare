import type { NativeMessage, ContentDiagnostic } from './lib/native-message';
import type { CallbackSender } from './lib/sender-container';
import type { ContentUnavailableReason, MessageUpdate } from './lib/message-update';

export interface Env {
  DB: D1Database;
  EVENT_DELIVERIES?: Queue<string>;
  CALLBACK_SENDER?: DurableObjectNamespace<CallbackSender>;
  OAUTH_KV?: KVNamespace;
  AI?: Pick<Ai, 'run' | 'toMarkdown'>;
  EVOLUTION_BASE_URL: string;
  EVOLUTION_GLOBAL_API_KEY?: string;
  TOKEN_ENCRYPTION_KEY: string;
  ACCESS_JWKS_URL?: string;
  ACCESS_ISSUER?: string;
  ACCESS_AUDIENCE?: string;
  LOCAL_DEV_USER_EMAIL?: string;
  CONSENT_SECRET?: string;
  ALLOWED_EMAILS?: string;
  /** Separate allowlist for the read-only operational admin panel. */
  ADMIN_EMAILS?: string;
  ENVIRONMENT?: string;
  MAX_MEDIA_BYTES?: string;
  SEND_MEDIA_ORIGINS?: string;
  /** Comma-separated, exact HTTPS storage origins approved for gallery images. */
  IMAGE_STORAGE_ORIGINS?: string;
  /** Comma-separated, exact HTTPS storage origins approved for audio transcription. */
  AUDIO_STORAGE_ORIGINS?: string;
  /** Comma-separated, exact HTTPS storage origins approved for PDF reading. */
  DOCUMENT_STORAGE_ORIGINS?: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionSummary {
  id: string;
  friendlyName: string;
  instanceId: string;
  phoneNumber?: string;
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

export interface MessageMediaItem {
  encodingFormat?: string;
  url?: string;
  content?: unknown;
  fileName?: string;
  fileSize?: number;
  duration?: number;
  pageCount?: number;
  width?: number;
  height?: number;
  waveform?: string;
  displayName?: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  speed?: number;
  degrees?: number;
  name?: string;
  address?: string;
}

export interface Message extends NativeMessage {
  contentDiagnostic?: ContentDiagnostic;
  contentPartial?: boolean;
  responseLinks?: Partial<Record<'votes' | 'eventResponses', string>>;
  id?: string;
  conversationId?: string;
  jid?: string;
  /** Who wrote the message (the JSON:API author). Our own number when the message was sent by this connection (fromMe). */
  source?: string;
  recipient?: string;
  direction?: 'inbound' | 'outbound' | 'unknown';
  timestamp?: string;
  status?: string;
  type?: string;
  text?: string;
  media?: { mimeType?: string; fileName?: string; size?: number; url?: string; mediaId?: string; gifPlayback?: boolean };
  medias?: MessageMediaItem[];
  flags?: number;
  quotedId?: string;
  mentions?: string[];
  contentUnavailable?: boolean;
  contentUnavailableReason?: ContentUnavailableReason | ContentDiagnostic['reason'];
  update?: MessageUpdate;
  /** Original provider type; unknown when absent, without guessing media expiry. */
  messageType?: string;
}

export interface SendMessageResult {
  messageId?: string;
  conversationId?: string;
  jid?: string;
  accepted: boolean;
  media?: { mimeType: string; fileName?: string; size?: number; gifPlayback?: boolean };
}
