-- Portfolio content: the projects (probes) and the career history, served by
-- GET /content (src/content.ts). One column per field of src/data/projects.json
-- and CareerEntry (src/data/career.ts). Edit rows in the Cloudflare D1 console
-- (beacon-api/README.md "Editing the content"). Apply with:
--   npx wrangler d1 execute fitz-beacons --remote --file=beacon-api/content.sql
-- then fill it once with the bundled data:
--   npx wrangler d1 execute fitz-beacons --remote --file=beacon-api/content-seed.sql
--
-- The CHECKs mirror the site's row rules (src/utils/contentParse.ts), so the
-- console refuses a bad edit outright. The site still checks every row; what
-- only it checks: reserved ids (destinations, planets, moons, other scannables)
-- and each tech entry being non-empty text. A blank optional field ('' or
-- spaces) counts as NULL.
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY       -- the probe id: lower-case slug, e.g. ruangrapi
              CHECK (length(id) BETWEEN 1 AND 32 AND id GLOB '[a-z0-9]*' AND NOT id GLOB '*[^a-z0-9_-]*'),
  sort        INTEGER NOT NULL,      -- order: probes take slots 1-6 in this order
  title       TEXT NOT NULL CHECK (trim(title) <> ''),
  role        TEXT NOT NULL CHECK (trim(role) <> ''),
  duration    TEXT NOT NULL CHECK (trim(duration) <> ''),
  short       TEXT NOT NULL CHECK (trim(short) <> ''),
  description TEXT NOT NULL CHECK (trim(description) <> ''),
  tech        TEXT NOT NULL          -- JSON array of strings, e.g. ["React","TypeScript"]
              CHECK (json_valid(tech) AND json_type(tech) = 'array' AND json_array_length(tech) > 0),
  color       TEXT NOT NULL          -- #rrggbb: the probe's tint
              CHECK (length(color) = 7 AND color GLOB '#*' AND NOT substr(color, 2) GLOB '*[^0-9A-Fa-f]*'),
  repo        TEXT                   -- https:// URL, or NULL
              CHECK (repo IS NULL OR trim(repo) = '' OR (repo GLOB 'https://?*' AND NOT repo GLOB '*[ ]*'))
);

CREATE TABLE IF NOT EXISTS career (
  id          INTEGER PRIMARY KEY,
  sort        INTEGER NOT NULL,      -- order in the résumé list (newest first); buoys sort by start
  role        TEXT NOT NULL CHECK (trim(role) <> ''),
  company     TEXT NOT NULL CHECK (trim(company) <> ''),
  note        TEXT,                  -- shown after the company, or NULL
  start       TEXT NOT NULL          -- "Mon YYYY", e.g. Nov 2020
              CHECK (start GLOB '[A-Z][a-z][a-z] [0-9][0-9][0-9][0-9]'
                     AND substr(start, 1, 3) IN ('Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec')),
  "end"       TEXT                   -- "Mon YYYY", or NULL for the current role
              CHECK ("end" IS NULL OR trim("end") = '' OR ("end" GLOB '[A-Z][a-z][a-z] [0-9][0-9][0-9][0-9]'
                     AND substr("end", 1, 3) IN ('Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'))),
  employment  TEXT NOT NULL CHECK (employment IN ('Full-time', 'Contract')),
  location    TEXT NOT NULL CHECK (trim(location) <> ''),
  summary     TEXT NOT NULL CHECK (trim(summary) <> '')
);
