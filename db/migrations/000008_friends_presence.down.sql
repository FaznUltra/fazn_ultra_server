DROP TABLE IF EXISTS friendships;
DROP TYPE IF EXISTS friendship_status;
ALTER TABLE users DROP COLUMN IF EXISTS last_seen_at;
