-- schema.sql — D1 (SQLite) schema for the waitlist
--
-- Apply locally:  pnpm db:schema:local
-- Apply to prod:  pnpm db:schema
-- Note: `ip_hash` stores HMAC-SHA256(ip, IP_SALT) — never a raw IP.

CREATE TABLE IF NOT EXISTS waitlist (
  id         INTEGER  PRIMARY KEY AUTOINCREMENT,
  email      TEXT     NOT NULL UNIQUE,
  created_at INTEGER  NOT NULL DEFAULT (unixepoch()),
  ip_hash    TEXT,
  user_agent TEXT,
  referrer   TEXT
);

CREATE INDEX IF NOT EXISTS waitlist_created_at_idx
  ON waitlist (created_at DESC);

-- Useful reads:
--   SELECT email, datetime(created_at, 'unixepoch') AS at
--   FROM waitlist ORDER BY created_at DESC LIMIT 50;
--
--   SELECT COUNT(*) FROM waitlist;
