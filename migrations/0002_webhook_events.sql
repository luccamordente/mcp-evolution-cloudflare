ALTER TABLE whatsapp_connections ADD COLUMN webhook_secret_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_connections_webhook_secret ON whatsapp_connections(webhook_secret_hash);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES whatsapp_connections(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  message_id TEXT,
  conversation_id TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  message_json TEXT NOT NULL,
  UNIQUE(connection_id, event_name, message_id)
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_connection_received ON webhook_events(connection_id, received_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_conversation_received ON webhook_events(connection_id, conversation_id, received_at);
