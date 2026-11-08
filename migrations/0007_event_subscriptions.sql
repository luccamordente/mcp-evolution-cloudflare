CREATE TABLE event_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_user_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  principal_key TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES whatsapp_connections(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL CHECK (event_name = 'message.received'),
  arguments_json TEXT NOT NULL,
  conversation_id TEXT,
  callback_url TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'active', 'cancelled', 'revoked')),
  encrypted_secret TEXT,
  secret_hash TEXT,
  encrypted_previous_secret TEXT,
  previous_secret_until INTEGER,
  verified_until INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  activated_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX event_subscriptions_connection ON event_subscriptions(connection_id, state, expires_at);
CREATE INDEX event_subscriptions_grant ON event_subscriptions(user_id, grant_id);
CREATE INDEX event_subscriptions_callback ON event_subscriptions(principal_key, callback_url, verified_until);

-- Local revocation fences callbacks while the OAuth Provider propagates revocation.
-- Seven days bounds every subscription lease; these records contain no credentials.
CREATE TABLE event_grant_revocations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grant_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, grant_id)
);
