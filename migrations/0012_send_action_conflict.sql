DROP TRIGGER IF EXISTS unified_send_blocks_legacy_key;
DROP TRIGGER IF EXISTS legacy_send_blocks_unified_key;

CREATE TRIGGER send_message_blocks_conflicting_action_key
BEFORE INSERT ON send_operations
WHEN NEW.operation = 'send_message' AND EXISTS (
  SELECT 1 FROM send_operations
  WHERE user_id = NEW.user_id AND connection_id = NEW.connection_id
    AND idempotency_key = NEW.idempotency_key
    AND operation IN ('send_text', 'reply_to_message', 'send_media', 'forward_message')
    AND expires_at > NEW.expires_at - 86400000
)
BEGIN
  SELECT RAISE(ABORT, 'send_action_conflict');
END;

CREATE TRIGGER conflicting_action_blocks_send_message_key
BEFORE INSERT ON send_operations
WHEN NEW.operation IN ('send_text', 'reply_to_message', 'send_media', 'forward_message') AND EXISTS (
  SELECT 1 FROM send_operations
  WHERE user_id = NEW.user_id AND connection_id = NEW.connection_id
    AND idempotency_key = NEW.idempotency_key AND operation = 'send_message'
    AND expires_at > NEW.expires_at - 86400000
)
BEGIN
  SELECT RAISE(ABORT, 'send_action_conflict');
END;
