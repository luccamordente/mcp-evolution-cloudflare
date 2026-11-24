-- A deterministic ID includes the authorization, destination, event and filters.
-- Keep the stop after the operational subscription and its URL are deleted.
CREATE TABLE event_subscription_stops (
  subscription_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX event_subscription_stops_user ON event_subscription_stops(user_id);

CREATE INDEX event_subscriptions_dashboard ON event_subscriptions(user_id, connection_id, expires_at DESC, id DESC)
  WHERE activated_at IS NOT NULL;
CREATE INDEX event_deliveries_dashboard ON event_deliveries(subscription_id, received_at DESC, id DESC);
