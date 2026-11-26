CREATE TABLE webhook_destinations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES whatsapp_connections(id) ON DELETE CASCADE,
  grant_id TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  hostname TEXT NOT NULL,
  conversation_ids TEXT NOT NULL,
  encrypted_key TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  grant_expires_at INTEGER
);
CREATE INDEX webhook_destinations_grant ON webhook_destinations(user_id, grant_id);
CREATE INDEX webhook_destinations_connection ON webhook_destinations(connection_id);

ALTER TABLE event_subscriptions ADD COLUMN destination_id TEXT REFERENCES webhook_destinations(id) ON DELETE CASCADE CHECK (
  (destination_id IS NULL AND length(callback_url) > 0)
  OR (destination_id IS NOT NULL AND callback_url = '' AND conversation_id IS NOT NULL AND length(trim(conversation_id)) > 0 AND encrypted_secret IS NULL)
);
CREATE INDEX event_subscriptions_destination ON event_subscriptions(destination_id);

CREATE TRIGGER webhook_destination_disabled AFTER UPDATE OF encrypted_key ON webhook_destinations
WHEN OLD.encrypted_key IS NOT NULL AND NEW.encrypted_key IS NULL
BEGIN
  UPDATE event_deliveries SET state = 'cancelled', body = NULL, lease_token = NULL,
    lease_until = NULL, result_code = 'authorization'
    WHERE state IN ('pending','delivering') AND subscription_id IN (
      SELECT id FROM event_subscriptions WHERE destination_id = NEW.id);
  UPDATE event_subscriptions SET state = 'revoked', version = version + 1,
    expires_at = MIN(expires_at, unixepoch('subsec') * 1000)
    WHERE destination_id = NEW.id AND state = 'active';
END;

CREATE TRIGGER webhook_destination_grant_revoked AFTER INSERT ON event_grant_revocations
BEGIN
  UPDATE webhook_destinations SET encrypted_key = NULL, version = version + 1
    WHERE user_id = NEW.user_id AND grant_id = NEW.grant_id AND encrypted_key IS NOT NULL;
END;

CREATE TRIGGER webhook_destination_grant_revoked_again AFTER UPDATE OF expires_at ON event_grant_revocations
BEGIN
  UPDATE webhook_destinations SET encrypted_key = NULL, version = version + 1
    WHERE user_id = NEW.user_id AND grant_id = NEW.grant_id AND encrypted_key IS NOT NULL;
END;

CREATE TRIGGER webhook_destination_owner_disabled AFTER UPDATE OF status ON users WHEN NEW.status != 'active'
BEGIN
  UPDATE webhook_destinations SET encrypted_key = NULL, version = version + 1
    WHERE user_id = NEW.id AND encrypted_key IS NOT NULL;
END;
