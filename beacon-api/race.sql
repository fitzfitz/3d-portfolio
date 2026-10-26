-- The ring race's best lap: one row per course (src/utils/raceProtocol.ts
-- RACE_COURSE_ID). The Sky room writes it after a finished, checked upload
-- (beacon-api/src/raceHttp.ts maybeStoreBest); GET /race/best serves it. With
-- no row, the server and the site race the seed lap (src/utils/race.ts seedLap).
-- Run once on the existing database, before deploying the Worker that reads it
-- (beacon-api/README.md, "Deploying the ring race"):
--   npx wrangler d1 execute fitz-beacons --remote --config beacon-api/wrangler.toml --file=beacon-api/race.sql
-- Safe to re-run: IF NOT EXISTS. schema.sql has the same table for a fresh database.
CREATE TABLE IF NOT EXISTS race_best (
  course   TEXT PRIMARY KEY,       -- RACE_COURSE_ID, e.g. 'loop-2'
  time_ms  INTEGER NOT NULL,       -- the lap time from the signed stamps (ms)
  ghost    TEXT NOT NULL,          -- the lap's path, as src/utils/race.ts encodeGhost writes it
  cc       TEXT,                   -- the racer's ISO alpha-2 country from CF-IPCountry, or NULL
  at       INTEGER NOT NULL        -- when it was set (epoch ms)
);
