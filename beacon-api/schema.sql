-- Visitor bottles (the table keeps its beacon name). For a fresh database:
--   npx wrangler d1 execute fitz-beacons --remote --config beacon-api/wrangler.toml --file=beacon-api/schema.sql
-- A database created before messages in bottles needs beacon-api/bottles.sql
-- instead (README.md, "Deploying bottles").
CREATE TABLE IF NOT EXISTS beacons (
  id       TEXT PRIMARY KEY,
  x        REAL NOT NULL,
  y        REAL NOT NULL,
  z        REAL NOT NULL,
  phrase   INTEGER NOT NULL DEFAULT -1, -- legacy: index into src/data/beaconPhrases.ts; -1 for a free-text bottle
  text     TEXT,                  -- the note, as src/utils/bottleFilter.ts passed it; NULL only on rows from the old Worker
  hidden   INTEGER NOT NULL DEFAULT 0, -- 1 = hidden by the owner; still counts toward the pilot's limits
  at       INTEGER NOT NULL,      -- epoch ms
  country  TEXT,                  -- ISO alpha-2 from CF-IPCountry, or NULL
  ip_hash  TEXT NOT NULL          -- HMAC-SHA256(IP_SALT, rate key); the raw IP is never stored
);
CREATE INDEX IF NOT EXISTS beacons_at ON beacons (at DESC);
CREATE INDEX IF NOT EXISTS beacons_ip_at ON beacons (ip_hash, at);

-- The ring race's best lap, one row per course. An existing database gets it
-- from beacon-api/race.sql (README.md, "Deploying the ring race").
CREATE TABLE IF NOT EXISTS race_best (
  course   TEXT PRIMARY KEY,       -- RACE_COURSE_ID, e.g. 'loop-2'
  time_ms  INTEGER NOT NULL,       -- the lap time from the signed stamps (ms)
  ghost    TEXT NOT NULL,          -- the lap's path, as src/utils/race.ts encodeGhost writes it
  cc       TEXT,                   -- the racer's ISO alpha-2 country from CF-IPCountry, or NULL
  at       INTEGER NOT NULL        -- when it was set (epoch ms)
);
