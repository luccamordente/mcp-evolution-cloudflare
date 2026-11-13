ALTER TABLE users ADD COLUMN clerk_user_id TEXT;
ALTER TABLE users ADD COLUMN invite_pending_at TEXT;
CREATE UNIQUE INDEX idx_users_clerk_user_id ON users(clerk_user_id) WHERE clerk_user_id IS NOT NULL;
