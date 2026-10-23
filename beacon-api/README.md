# Beacon API

The small Cloudflare Worker behind visitor beacons. A visitor can drop a beacon
where their ship is. Each beacon carries one phrase from a fixed list, and later
visitors see it in space and can scan it.

The site works without this API. With `VITE_BEACON_API` empty, the beacon
feature does not render at all, and the projects and career come from the
bundled files.

The same Worker serves the portfolio's projects and career history from D1
(`GET /content`, read-only; see "Editing the content" below).

## Design

- **No free text.** A beacon stores an index into
  [`src/data/beaconPhrases.ts`](../src/data/beaconPhrases.ts), and the Worker
  rejects any other value. Nobody can write words onto the page, so there is no
  text to moderate. Spam is still possible: someone can drop many beacons, or
  drop them somewhere annoying. The limits below bound that, and you can delete
  rows (see "Moderating" below). The phrase list is append-only, because old
  beacons refer to their phrase by position.
- **The same validation runs in two places.** `validateDrop` in
  [`src/utils/beacons.ts`](../src/utils/beacons.ts) checks drops in both the
  client and the Worker. It also refuses drops near the spawn pad, where every
  visitor starts. The client treats the `GET` response as untrusted:
  `parseBeacons` drops malformed rows and caps the list.
- **Rate limits.** A single SQL statement checks the limits and inserts the
  row, so a parallel burst cannot slip past. The limits are:
  - **Per pilot:** one beacon every 10 minutes.
  - **Overall:** 10 drops per minute across everyone. This bounds a flood from
    rotating IPs. It also stops the table turning over faster than the
    per-pilot window, which matters because the per-pilot limit lives in those
    rows.
- **Pilot identity is hashed.** A pilot is an HMAC-SHA256, keyed with
  `IP_SALT`, of the client IP. IPv6 addresses are cut to their /64 first,
  because one home connection owns 2^64 addresses. The raw IP is never stored.
  Rotating `IP_SALT` makes the stored hashes useless. If `IP_SALT` is shorter
  than 16 characters, every `POST` fails with 500 rather than storing hashes
  that could be reversed.
- **Per-pilot request budget.** 30 requests a minute (see "Request quota"
  below).
- **Reads are cheap.** `GET` serves the newest 40 rows from a 30-second cache
  in each isolate, so repeat reads skip D1. The table keeps the newest 500
  rows.
- **The origin check is not abuse protection.** A `POST` must carry an
  `Origin` from `ALLOWED_ORIGINS`, which stops other websites' pages from
  writing here. Any script can forge that header, so the rate limits are what
  actually bound abuse.
- **Country is public.** It comes from `CF-IPCountry` and appears on a scan as
  "PILOT FROM ID", along with how long ago the beacon was dropped. The picker
  tells visitors this before they drop. Unknown (`XX`) and Tor (`T1`) are
  stored as null.

The handler lives in `src/handler.ts` and has no Cloudflare bindings. Its tests
are in [`tests/beaconApi.test.ts`](../tests/beaconApi.test.ts) and run under
the root `npm test`. `src/index.ts` is the D1 adapter.

## Live sky

The same Worker relays live sky: other visitors flying right now appear as
ghost ships (spec: `docs/superpowers/specs/2026-10-14-live-sky-design.md`).

- **One room.** `GET /live` is a WebSocket upgrade into a single Durable Object,
  `Sky`, using the hibernation API. The room logic is pure and unit tested
  (`src/sky.ts`, `tests/skyRoom.test.ts`); the upgrade gate is
  `src/liveRoute.ts` (Origin in `ALLOWED_ORIGINS`, one `LIMITER` token per
  attempt).
- **Nothing is stored.** No tables, no storage API, no IPs. A pilot is a
  random id (new every connection), a country from `CF-IPCountry` (`XX` and
  `T1` become null, as with beacons), their last pose (with how many of the
  five worlds they have charted, 0–5), and a visitor key, all held in the
  socket's attachment. Closing the socket forgets them.
- **The cartographer.** A pose's optional `ch` is the pilot's charted count
  (anything malformed reads as 0, never rejected), and the AURUM plume
  (`cartographer`) passes only with `ch: 5` in the same message. A pilot who
  charts the fifth world sends `{"t":"charted"}` once; the room relays
  `{"t":"charted","cc"}` to everyone else only after a pose with `ch: 5`,
  once per connection, once a day per visitor key and at most once a minute
  room-wide. That anti-spam lives in the room's memory only, never stored,
  so a hibernated room may forget it. The live-sky notice names the charted
  count, and pilots who agreed to the earlier notice hear the new one first.
- **Visitor key.** The Worker hashes the client IP (IPv4, or IPv6 /64) with
  `IP_SALT`, as beacons do, and passes it to the room in `X-Sky-Visitor`,
  replacing anything a client sent. The room uses it only to cap one visitor
  at 3 places and never sends it out. Without a 16+ character salt the key is
  null and the cap is off.
- **Quiet when alone.** Clients send their pose only while someone else is in
  the room and only when it changes, at most 5 times a second. The room
  snapshots at most every 250 ms, plus one trailing snapshot so a last move is
  never lost. With nobody moving, the room hibernates.
- **Limits.** 40 sockets, and 3 per visitor (over either, `full` and close
  1013; the client retries after 5 minutes); messages over 256 bytes are
  dropped; more than 10 messages in any one-second span closes the socket
  (1008).
- **Cost.** On the Workers Free plan (100k requests and 13,000 GB-s a day;
  incoming WebSocket messages bill 20:1, outgoing are free; no duration while
  hibernating), two pilots flying together cost about 900 requests each per
  hour, so roughly 110 pilot-hours of overlap a day fit. Past the quota,
  connections fail, clients back off, and visitors are simply alone until
  00:00 UTC. The Workers Paid plan removes the ceiling.

**Kill switch:** empty `VITE_LIVE_SKY` in `.env.production` and merge. The
room can stay deployed; nothing connects to it.

## Deploying

Run these from the repo root. Wrangler is not a dependency of this repo, so
`npx` fetches it on first use. You need a Cloudflare login (`npx wrangler login`).

```bash
# 1. Create the database, and paste its id into beacon-api/wrangler.toml
npx wrangler d1 create fitz-beacons

# 2. Create the tables: beacons, then the content tables and their first rows
npx wrangler d1 execute fitz-beacons --remote --file=beacon-api/schema.sql
npx wrangler d1 execute fitz-beacons --remote --file=beacon-api/content.sql
npx wrangler d1 execute fitz-beacons --remote --file=beacon-api/content-seed.sql

# 3. Set ALLOWED_ORIGINS in wrangler.toml to every host that serves the site
#    (comma-separated), then deploy. Drops fail closed until step 4.
npx wrangler deploy --config beacon-api/wrangler.toml

# 4. Set the salt (any long random string), then confirm it is listed
openssl rand -hex 32 | npx wrangler secret put IP_SALT --config beacon-api/wrangler.toml
npx wrangler secret list --config beacon-api/wrangler.toml
```

Deploying also creates the `Sky` Durable Object from `wrangler.toml`
(`[[durable_objects.bindings]]` plus `[exports.Sky]`); no other step is needed.
Point the site at it with `VITE_LIVE_SKY=wss://<worker host>/live` in
`.env.production`.

**Request quota.** `wrangler.toml` binds the Workers Rate Limiting API as
`LIMITER`: 30 requests a minute per pilot, counted per Cloudflare location,
across GET and POST, with preflights free. It does the job of a WAF rule; a WAF
rule would need a zone, and this Worker runs on `workers.dev`. The drop limits
protect the data, and this budget protects your Worker and D1 quotas from a
GET loop. The counters are approximate by design, so a burst can slip a few
requests past before the 429s start.

Then give the site the Worker's URL by setting `VITE_BEACON_API` in the
committed [`.env.production`](../.env.production). Every production build
reads that file, so both hosts (GitHub Pages and the Cloudflare copy) pick it
up on the next deploy, with no per-host settings. For `npm run dev`, set it in
`.env`.

## Editing the content

`GET /content` serves the portfolio's projects and career history from two D1
tables, `projects` and `career` (schema: [`content.sql`](content.sql); spec:
`docs/superpowers/specs/2026-10-23-dynamic-content-design.md`). There is no
admin page and no write endpoint: edit the rows in the Cloudflare dashboard,
under **Storage & Databases → D1 → fitz-beacons → Console** (or the table
browser next to it), or with `wrangler d1 execute --remote --command`.

Visitors see an edit on their next visit, within about five minutes. The
response is publicly cacheable for 300 s, and each Worker isolate keeps it for
60 s. A visit never changes mid-flight.

### Columns

`projects`: one row per project. Each project becomes a probe, and the first
six by `sort` get one.

| Column | What it holds |
| --- | --- |
| `id` | The probe id: lower-case letters, digits, `-` or `_`, up to 32. Not `career`, `shipyard`, `contact`, a planet (`earth` …) or a logbook badge (`ring` …). Changing it loses visitors' "read" mark for that dossier. |
| `sort` | Order: probe slot 1 is the lowest. The seed uses steps of 10. |
| `title`, `role`, `duration`, `short`, `description` | Non-empty text. |
| `tech` | A JSON array of strings: `["React","TypeScript"]`. |
| `color` | `#rrggbb`: the probe's tint, its HUD row and its jump button. |
| `repo` | An `https://` URL, or NULL. |

`career`: one row per job.

| Column | What it holds |
| --- | --- |
| `id` | Any unique integer. |
| `sort` | Order in the résumé list (newest first today). The trail's buoys are always ordered by `start`. |
| `role`, `company`, `location`, `summary` | Non-empty text. |
| `note` | Shown after the company, e.g. `formerly BCI Central`, or NULL. |
| `start` | `Mon YYYY`, e.g. `Nov 2020`. |
| `"end"` | `Mon YYYY`, or NULL for the current role. Quote it in SQL: `end` is a keyword. |
| `employment` | `Full-time` or `Contract`. |

The schema refuses a bad `color`, `tech` or `employment` value outright. The
site also checks every row as it loads: a row that breaks a rule is dropped,
with a `console.warn` in the browser console naming the row and the rule. If
no row of a table is valid, the site uses its bundled copy of that table.
Twelve jobs fit the career trail; past that, the oldest have no buoy but still
show in the résumé. Past six projects, the rest have no probe but still show in
the résumé.

### Examples

```sql
-- Fix a typo
UPDATE projects SET short = 'Rental operations SaaS for Indonesian landlords.' WHERE id = 'ruangrapi';

-- Add a project as the fourth probe (slot 4)
INSERT INTO projects (id, sort, title, role, duration, short, description, tech, color, repo)
VALUES ('atlas', 40, 'Atlas', 'Personal project', '2027', 'One line for the card.',
        'The dossier''s longer description.', '["Go","SQLite"]', '#ff8800', 'https://github.com/fitzfitz/atlas');

-- Reorder: put fuxx first (it takes probe slot 1)
UPDATE projects SET sort = 5 WHERE id = 'fuxx';

-- A new job: the current one gets an end date, the new one has none
UPDATE career SET "end" = 'Dec 2026' WHERE company = 'Hubexo';
INSERT INTO career (id, sort, role, company, note, start, "end", employment, location, summary)
VALUES (6, 5, 'Staff Engineer', 'Acme', NULL, 'Jan 2027', NULL, 'Full-time', 'Jakarta, Indonesia', 'What the role is.');

-- Remove a project
DELETE FROM projects WHERE id = 'atlas';
```

From a terminal, the same with `--remote`, from the repo root:

```bash
npx wrangler d1 execute fitz-beacons --remote \
  --command "SELECT id, sort, title, color FROM projects ORDER BY sort"
```

### Creating the tables and the first rows

Once, before the site that reads `/content` is released (both are safe to run
again):

```bash
# The two tables
npx wrangler d1 execute fitz-beacons --remote --file=beacon-api/content.sql
# The first rows, identical to the bundled data. INSERT OR IGNORE: running it
# again never overwrites an edit.
npx wrangler d1 execute fitz-beacons --remote --file=beacon-api/content-seed.sql
```

`content-seed.sql` is generated from `src/data/projects.json` and
`src/data/career.ts` (`npm run content:seed`); `tests/contentSeed.test.ts` fails
when it drifts from them. To reset D1 to the bundled copy, empty the tables first
(`DELETE FROM projects; DELETE FROM career;`), then run the seed again.

The bundled files stay the site's fallback: keep them roughly in step with D1
when it matters (offline visitors and a broken database see them), and
`index.html`'s `<noscript>` summary is kept by hand.

## Moderating

```bash
# What is up there right now (newest first)
npx wrangler d1 execute fitz-beacons --remote \
  --command "SELECT id, phrase, at, country FROM beacons ORDER BY at DESC LIMIT 50"

# Remove one
npx wrangler d1 execute fitz-beacons --remote \
  --command "DELETE FROM beacons WHERE id = '<id>'"

# Remove a burst (epoch ms)
npx wrangler d1 execute fitz-beacons --remote \
  --command "DELETE FROM beacons WHERE at > <epoch-ms>"
```

**Kill switch:** empty `VITE_BEACON_API` in `.env.production` and merge. Both
hosts redeploy without the feature, and the data stays in D1.
