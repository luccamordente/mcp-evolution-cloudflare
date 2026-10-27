-- Messages wapilot itself sent. Evolution Go does not store API sends, and an
-- instance's webhook may point elsewhere, so forward_message needs this record.
CREATE TABLE IF NOT EXISTS outbound_messages (
  connection_id TEXT NOT NULL REFERENCES whatsapp_connections(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  conversation_id TEXT,
  encoding_format TEXT NOT NULL,
  text TEXT,
  media_json TEXT,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (connection_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_conversation ON outbound_messages(connection_id, conversation_id, sent_at);
