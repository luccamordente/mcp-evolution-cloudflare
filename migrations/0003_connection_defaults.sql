ALTER TABLE whatsapp_connections ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
ALTER TABLE whatsapp_connections ADD COLUMN connection_state TEXT NOT NULL DEFAULT 'connected'
  CHECK (connection_state IN ('provisioning', 'qr', 'connected', 'expired', 'offline', 'error'));
UPDATE whatsapp_connections
SET is_default = 1
WHERE id IN (SELECT MIN(id) FROM whatsapp_connections GROUP BY user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_user_default
  ON whatsapp_connections(user_id)
  WHERE is_default = 1;
