-- Evolution Go is the source of truth for connection availability. Remove the
-- legacy D1 runtime-state columns after the application stops reading them.
ALTER TABLE whatsapp_connections DROP COLUMN status;
ALTER TABLE whatsapp_connections DROP COLUMN connection_state;
