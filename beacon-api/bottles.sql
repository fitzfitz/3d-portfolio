-- Messages in bottles: migrates a beacons table created by the old schema.sql.
-- Run ONCE against an existing database, before deploying the Worker that
-- writes text (beacon-api/README.md, "Deploying bottles"):
--   npx wrangler d1 execute fitz-beacons --remote --config beacon-api/wrangler.toml --file=beacon-api/bottles.sql
-- A fresh database needs only schema.sql, which already has these columns.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this is not re-runnable as a
-- whole: a second run stops at the first ALTER ("duplicate column name:
-- text") and changes nothing. The backfill alone is safe to repeat.
--
-- `phrase` stays NOT NULL with no default here (relaxing it would mean
-- rebuilding the table); the new Worker writes -1 for a free-text bottle.

ALTER TABLE beacons ADD COLUMN text TEXT;
ALTER TABLE beacons ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

-- Each legacy row says its phrase as text. The strings are BEACON_PHRASES in
-- src/data/beaconPhrases.ts, by index; tests/bottleApi.test.ts checks they match.
UPDATE beacons SET text = CASE phrase
  WHEN 0 THEN 'HELLO FROM ORBIT'
  WHEN 1 THEN 'NICE VIEW'
  WHEN 2 THEN 'TRY WARP HERE'
  WHEN 3 THEN 'SHARD NEARBY'
  WHEN 4 THEN 'WATCH FOR ROCKS'
  WHEN 5 THEN 'THE JELLYFISH WAS HERE'
  WHEN 6 THEN 'BEAT PAR. YOUR MOVE'
  WHEN 7 THEN 'LOST. SEND COFFEE'
  WHEN 8 THEN 'HIRE THIS PILOT'
END
WHERE text IS NULL;
