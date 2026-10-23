-- Portfolio content: the projects (probes) and the career history, served by
-- GET /content (src/content.ts). One column per field of src/data/projects.json
-- and CareerEntry (src/data/career.ts). Edit rows in the Cloudflare D1 console
-- (beacon-api/README.md "Editing the content"). Apply with:
--   npx wrangler d1 execute fitz-beacons --remote --file=beacon-api/content.sql
-- then fill it once with the bundled data:
--   npx wrangler d1 execute fitz-beacons --remote --file=beacon-api/content-seed.sql
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,      -- the probe id: lower-case slug, e.g. ruangrapi
  sort        INTEGER NOT NULL,      -- order: probes take slots 1-6 in this order
  title       TEXT NOT NULL,
  role        TEXT NOT NULL,
  duration    TEXT NOT NULL,
  short       TEXT NOT NULL,
  description TEXT NOT NULL,
  tech        TEXT NOT NULL          -- JSON array of strings, e.g. ["React","TypeScript"]
              CHECK (json_valid(tech) AND json_type(tech) = 'array'),
  color       TEXT NOT NULL          -- #rrggbb: the probe's tint
              CHECK (length(color) = 7 AND color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  repo        TEXT                   -- https:// URL, or NULL
);

CREATE TABLE IF NOT EXISTS career (
  id          INTEGER PRIMARY KEY,
  sort        INTEGER NOT NULL,      -- order in the résumé list (newest first); buoys sort by start
  role        TEXT NOT NULL,
  company     TEXT NOT NULL,
  note        TEXT,                  -- shown after the company, or NULL
  start       TEXT NOT NULL,         -- "Mon YYYY", e.g. Nov 2020
  "end"       TEXT,                  -- "Mon YYYY", or NULL for the current role
  employment  TEXT NOT NULL CHECK (employment IN ('Full-time', 'Contract')),
  location    TEXT NOT NULL,
  summary     TEXT NOT NULL
);
