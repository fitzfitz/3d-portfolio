-- Visitor beacons. Apply with:
--   npx wrangler d1 execute fitz-beacons --remote --file=beacon-api/schema.sql
CREATE TABLE IF NOT EXISTS beacons (
  id       TEXT PRIMARY KEY,
  x        REAL NOT NULL,
  y        REAL NOT NULL,
  z        REAL NOT NULL,
  phrase   INTEGER NOT NULL,     -- index into src/data/beaconPhrases.ts
  at       INTEGER NOT NULL,     -- epoch ms
  country  TEXT,                 -- ISO alpha-2 from CF-IPCountry, or NULL
  ip_hash  TEXT NOT NULL         -- SHA-256(IP_SALT:ip); the raw IP is never stored
);
CREATE INDEX IF NOT EXISTS beacons_at ON beacons (at DESC);
CREATE INDEX IF NOT EXISTS beacons_ip_at ON beacons (ip_hash, at);
