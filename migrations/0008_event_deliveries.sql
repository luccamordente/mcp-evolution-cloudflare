-- Content exists only on selected pending deliveries; source markers contain IDs only.
CREATE TABLE event_sources (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE(connection_id,message_id)
);
CREATE INDEX event_sources_expiry ON event_sources(expires_at);

CREATE TABLE event_deliveries (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  body TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending','delivering','accepted','cancelled','expired','failed')),
  received_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  published_at INTEGER,
  lease_token TEXT,
  lease_until INTEGER,
  result_code TEXT,
  UNIQUE(source_id,subscription_id)
);
CREATE INDEX event_deliveries_due ON event_deliveries(state,next_attempt_at);
CREATE INDEX event_deliveries_subscription ON event_deliveries(subscription_id,state);
CREATE INDEX event_deliveries_expiry ON event_deliveries(expires_at);

-- Preserve only delivery result IDs when a cascading connection/user deletion removes a subscription.
CREATE TRIGGER event_subscription_delete_content AFTER DELETE ON event_subscriptions
BEGIN
  UPDATE event_deliveries SET state = 'cancelled', body = NULL, lease_token = NULL,
    lease_until = NULL, result_code = 'authorization'
    WHERE subscription_id = OLD.id AND state IN ('pending','delivering');
END;
CREATE TRIGGER event_user_disable_content AFTER UPDATE OF status ON users WHEN NEW.status != 'active'
BEGIN
  UPDATE event_deliveries SET state = 'cancelled', body = NULL, lease_token = NULL,
    lease_until = NULL, result_code = 'authorization'
    WHERE subscription_id IN (SELECT id FROM event_subscriptions WHERE user_id = NEW.id)
      AND state IN ('pending','delivering');
END;
