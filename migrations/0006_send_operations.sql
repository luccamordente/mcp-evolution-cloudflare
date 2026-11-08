CREATE TABLE send_operations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES whatsapp_connections(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'unknown')),
  result_json TEXT,
  expires_at INTEGER NOT NULL,
  UNIQUE (user_id, connection_id, operation, idempotency_key)
);
CREATE INDEX idx_send_operations_expiry ON send_operations(expires_at);
