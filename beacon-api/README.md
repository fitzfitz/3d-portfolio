# Beacon API

The small Cloudflare Worker behind messages in bottles (formerly beacons). A
visitor can leave a bottle where their ship is, carrying a short free-text
note, and later visitors see it in space and can read it. The routes and the
table keep their beacon names. Spec:
`docs/archive/specs/2026-10-26-message-bottles-design.md`.

The site works without this API. With `VITE_BEACON_API` empty, the beacon
feature does not render at all, and the projects and career come from the
bundled files.

The same Worker serves the portfolio's projects and career history from D1
(`GET /content`, read-only; see "Editing the content" below).

## Design

- **Filtered free text, auto-published.** A note passes
  [`src/utils/bottleFilter.ts`](../src/utils/bottleFilter.ts) on the Worker,
  which is the authority (the client runs the same function for instant
  feedback): 3–140 characters after normalising, no links or contact details,
  no profanity (EN + ID list), no junk. The Worker stores the normalised text.
  The owner can hide any note (see "Moderating" below). Text is rendered as
  plain text only.
- **The same position check runs in two places.** `validatePosition` in
  [`src/utils/beacons.ts`](../src/utils/beacons.ts) checks drops in both the
  client and the Worker. It also refuses drops near the spawn pad, where every
  visitor starts.
- **Rate limits.** A single SQL statement checks the limits and inserts the
  row, so a parallel burst cannot slip past. The limits are:
  - **Per pilot:** one bottle every 10 minutes, and at most 5 in any 24 hours
    (`BOTTLE_DAILY_CAP`). Hidden notes still count.
  - **Overall:** 10 drops per minute across everyone. This bounds a flood from
    rotating IPs, and how fast the table grows.

  The per-pilot limits live in the rows, so prune never deletes a row younger
  than a day: the table keeps the newest 500 rows, plus every row from the
  last 24 hours (at most 14,400 at the overall cap).
- **Pilot identity is hashed.** A pilot is an HMAC-SHA256, keyed with
  `IP_SALT`, of the client IP. IPv6 addresses are cut to their /64 first,
  because one home connection owns 2^64 addresses. The raw IP is never stored.
  Rotating `IP_SALT` makes the stored hashes useless. If `IP_SALT` is shorter
  than 16 characters, every `POST` fails with 500 rather than storing hashes
  that could be reversed.
- **Per-pilot request budget.** 30 requests a minute (see "Request quota"
  below).
- **Reads are cheap.** `GET` serves the newest 30 visible rows
  (`BOTTLE_LIMIT`) from a 30-second cache in each isolate, so repeat reads
  skip D1.
- **The origin check is not abuse protection.** A `POST` must carry an
  `Origin` from `ALLOWED_ORIGINS`, which stops other websites' pages from
  writing here. Any script can forge that header, so the rate limits are what
  actually bound abuse.
- **Country is public.** It comes from `CF-IPCountry` and shows on the note's
  card, along with how long ago it was left. Unknown (`XX`) and Tor (`T1`) are
  stored as null.

The handler lives in `src/handler.ts` and has no Cloudflare bindings. The D1
adapter is `src/d1Store.ts`; `src/index.ts` wires them together. Tests:
[`tests/beaconApi.test.ts`](../tests/beaconApi.test.ts) (the handler, over an
in-memory store) and [`tests/bottleApi.test.ts`](../tests/bottleApi.test.ts)
(the handler over the real SQL on SQLite, plus the migration). Both run under
the root `npm test`.

## The bottles API

```
GET  /beacons
  200 { beacons: [{ id, x, y, z, text, at, country }, …] }
      newest first, at most 30, hidden rows left out

POST /beacons   { x, y, z, text }
  201 { beacon: { id, x, y, z, text, at, country } }   text as stored (normalised)
  403 { error: "origin" }                              Origin not in ALLOWED_ORIGINS
  415 { error: "json only" }                           Content-Type is not application/json
  413 { error: "too large" }                           body over the byte cap
  400 { error: "bad json" }                            body is not JSON
  400 { error: "invalid beacon" }                      bad position, or no text
  400 { error: "rejected", reason }                    the filter refused the note:
        reason = too_short | too_long | contact | profanity | junk
  429 { error: "rate", reason, retryAfter }            also a Retry-After header (s):
        reason = wait  (one per 10 minutes)
               | daily (5 per 24 hours)
               | busy  (10 a minute across everyone)
  429 { error: "slow down" }                           the request budget (LIMITER)
```

Checks run in this order: the request budget, the origin, the body (type,
size, JSON), the position, the filter, then the drop limits in one insert. A refused note costs the pilot nothing but the
request.

**Legacy body.** `POST { x, y, z, phrase }` (a `BEACON_PHRASES` index) still
works, so a cached old site keeps working through the deploy. It is stored
with that phrase's text, skipping the filter (the phrases are the owner's own
strings). Rows with a phrase are served with `phrase` as well, which the old
site needs; a free-text row stores `phrase = -1` and the old site skips it.

## The `hidden` column

`beacons.hidden` is 0 or 1 (default 0). A row with `hidden = 1` is never
served, to anyone; it still counts toward its pilot's limits, so hiding a note
does not refund it. To hide a note, find its id, then in the Cloudflare
dashboard (**Storage & Databases → D1 → fitz-beacons → Console**) run:

```sql
UPDATE beacons SET hidden = 1 WHERE id = '…';
```

Visitors stop seeing it within about a minute (30 s per isolate, plus 30 s of
public caching). `hidden = 0` brings it back. The author still sees their own
hidden note in their browser (`fitz-own-bottles`). Hiding has no effect until the
new Worker is deployed (step 2), because the old Worker ignores `hidden`.

## Live sky

The same Worker relays live sky: other visitors flying right now appear as
ghost ships (spec: `docs/archive/specs/2026-10-14-live-sky-design.md`).

- **One room.** `GET /live` is a WebSocket upgrade into a single Durable Object,
  `Sky`, using the hibernation API. The room logic is pure and unit tested
  (`src/sky.ts`, `tests/skyRoom.test.ts`); the upgrade gate is
  `src/liveRoute.ts` (Origin in `ALLOWED_ORIGINS`, one `LIMITER` token per
  attempt).
- **No pilot is stored.** No tables and no IPs. A pilot is a
  random id (new every connection), a country from `CF-IPCountry` (`XX` and
  `T1` become null, as with beacons), their last pose (with how many of the
  five worlds they have charted, 0–5), and a visitor key, all held in the
  socket's attachment. Closing the socket forgets them. The one thing the
  room keeps in its storage is the ring race state (see "The ring race").
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

## The ring race

The live-sky room also runs the multiplayer ring race (spec:
`docs/archive/specs/2026-10-26-ring-race-design.md`). Race messages ride
the `/live` socket under their own `r…` types; the room logic is pure and
unit tested (`src/raceRoom.ts`, `tests/raceRoom.test.ts`).

- **Signed ring stamps.** The room signs each ring a racer reaches with an
  HMAC keyed by `RACE_SECRET`, only for the racer's next ring, only near the
  ring by the pilot's last pose (timed by when the room received it) and
  never faster than warp allows. Without a 32+ character `RACE_SECRET`,
  racing fails closed (`rerr off`, and `POST /race/result` is 503) while
  bottles, content and live-sky poses keep working.
- **Stored race state.** The race room (lobbies, racers' tokens and ring
  counters, deadlines) is put in the `Sky` Durable Object's storage only when
  an event changed it (a no-op message writes nothing), and an alarm at the
  next deadline carries it on through hibernation. It is gone once results are out. After a restart, racers whose
  sockets are gone are unbound and can rejoin by token.
- **One best lap.** `race_best` (`race.sql`) holds one row per course: the
  fastest checked lap and its path. With no row, the time to beat is the seed
  lap (`seedLap` in `src/utils/race.ts`).

```
GET  /race/best
  200 { course, timeMs, ghost, cc, at }     the best lap (ghost as encodeGhost writes it)
  200 { course, timeMs: null }              no best yet: race the seed lap
  503 { error: "unavailable" }              race_best missing or D1 down
      cached 30 s per isolate, and public, max-age=30

POST /race/result   { race, token, stamps, ghost? }    at most 64 KB
  200 { ok: true, entry: { cc, timeMs, rings, lastAt } }    timeMs null = DNF
  400 { ok: false, reason }    malformed | off | sig | race | order | speed | start
  404 { ok: false, reason }    race | token
  409 { ok: false, reason }    phase | late | duplicate
  403 { error: "origin" }      Origin not in ALLOWED_ORIGINS
  413 { error: "too large" }
  503 { error: "racing is off" }    no usable RACE_SECRET
  429 { error: "slow down" }        the request budget (LIMITER)
```

The Worker forwards the raw body to the `Sky` room, which checks the stamps
and, on a 200 with a finished lap, stores it as the best lap when it beats the
row (or the seed lap), the ghost decodes and its path matches the stamps
(`checkPath`). The reply never carries the race or any token. Tests:
`tests/raceHttp.test.ts` (the routes), `tests/raceBest.test.ts` (the best-lap
SQL over SQLite) and `tests/skyAdapter.test.ts` (the Durable Object wiring).

## Deploying

Run these from the repo root. Wrangler is not a dependency of this repo, so
`npx` fetches it on first use. You need a Cloudflare login (`npx wrangler login`).

```bash
# 1. Create the database, and paste its id into beacon-api/wrangler.toml
npx wrangler d1 create fitz-beacons --config beacon-api/wrangler.toml

# 2. Create the tables: beacons and race_best, then the content tables and their first rows
npx wrangler d1 execute fitz-beacons --remote --config beacon-api/wrangler.toml --file=beacon-api/schema.sql
npx wrangler d1 execute fitz-beacons --remote --config beacon-api/wrangler.toml --file=beacon-api/content.sql
npx wrangler d1 execute fitz-beacons --remote --config beacon-api/wrangler.toml --file=beacon-api/content-seed.sql

# 3. Set ALLOWED_ORIGINS in wrangler.toml to every host that serves the site
#    (comma-separated), then deploy. Drops fail closed until step 4.
npx wrangler deploy --config beacon-api/wrangler.toml

# 4. Set the salt (any long random string) and the race stamp secret (32+
#    characters; racing is off without it), then confirm both are listed
openssl rand -hex 32 | npx wrangler secret put IP_SALT --config beacon-api/wrangler.toml
openssl rand -hex 32 | npx wrangler secret put RACE_SECRET --config beacon-api/wrangler.toml
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

### Deploying bottles (once, on the existing database)

The production table predates bottles, so it needs `bottles.sql`, which adds
`text` and `hidden` and fills `text` for the old phrase rows. Three steps, in
this order. **Each one needs the owner's word.**

```bash
# 1. Migrate. Run once: a second run stops at the first ALTER with
#    "duplicate column name: text" and changes nothing.
npx wrangler d1 execute fitz-beacons --remote --config beacon-api/wrangler.toml --file=beacon-api/bottles.sql
npx wrangler d1 execute fitz-beacons --remote --config beacon-api/wrangler.toml \
  --command "SELECT phrase, text, hidden, COUNT(*) FROM beacons GROUP BY phrase, text, hidden"

# 2. Deploy the Worker. It serves the old site too (legacy POST, phrase in GET).
npx wrangler deploy --config beacon-api/wrangler.toml

# 3. Merge the site (messages in bottles), which deploys staging; production
#    follows with the next v* release.
```

Why this order: the new Worker writes the `text` column, so it fails on an
unmigrated table; the old Worker ignores the new columns, so migrating first
is safe. Rows the old Worker writes between steps 1 and 2 have no `text`; the
new Worker reads them as their phrase's text. If only one of the two ALTERs
ever landed, run the missing one by hand with `--command`, then re-run the
`UPDATE` from `bottles.sql` (safe to repeat), since the script stopped before
it; until then the Worker's read-time mapping already shows those rows' phrase text.

Then give the site the Worker's URL by setting `VITE_BEACON_API` in the
committed [`.env.production`](../.env.production). Every production build
reads that file, so both hosts (GitHub Pages and the Cloudflare copy) pick it
up on the next deploy, with no per-host settings. For `npm run dev`, set it in
`.env`.

### Deploying the ring race (once, on the existing database)

Four steps, in this order. **Each one needs the owner's word.** Never run a
bare `wrangler deploy`: the root `wrangler.jsonc` is the production site.

```bash
# 1. The best-lap table. Safe to re-run (CREATE TABLE IF NOT EXISTS).
npx wrangler d1 execute fitz-beacons --remote --config beacon-api/wrangler.toml --file=beacon-api/race.sql

# 2. The stamp secret: 32+ characters, not IP_SALT. Then confirm it is listed.
openssl rand -hex 32 | npx wrangler secret put RACE_SECRET --config beacon-api/wrangler.toml
npx wrangler secret list --config beacon-api/wrangler.toml

# 3. Deploy the Worker (the Sky room's race logic, /race/best, /race/result).
npx wrangler deploy --config beacon-api/wrangler.toml

# 4. Merge the site (the ring race), which deploys staging; production
#    follows with the next v* release.
```

Why this order: the new Worker reads `race_best`, so the table comes first
(without it `GET /race/best` is a 503 and the site races the seed lap). Without
the secret the new Worker still serves everything else and turns racing away
(`rerr off`, 503), so steps 2 and 3 may swap. The old site never sends race
messages, so the Worker can go out before the site. Rotating `RACE_SECRET`
voids the stamps of races in flight (their uploads fail with `sig`) but not
the stored best lap.

## Editing the content

`GET /content` serves the portfolio's projects and career history from two D1
tables, `projects` and `career` (schema: [`content.sql`](content.sql); spec:
`docs/archive/specs/2026-10-23-dynamic-content-design.md`). There is no
admin page and no write endpoint: edit the rows in the Cloudflare dashboard,
under **Storage & Databases → D1 → fitz-beacons → Console** (or the table
browser next to it), or with `wrangler d1 execute --remote --config beacon-api/wrangler.toml --command`.

Visitors see an edit on their next visit, after up to about six minutes: the
response is publicly cacheable for 300 s, and each Worker isolate keeps it for
60 s on top. A visit never changes mid-flight.

**Verify your edit.** Ask the Worker what it serves now (it may be up to a
minute behind, the isolate cache):

```bash
curl -s -H "Origin: https://porto.fitzgeral.my.id" https://fitz-beacons.fitzgeralmedia.workers.dev/content
```

Every row of both tables should be in the answer. The site then checks each
row again: a row that is in the answer but missing on the site broke one of the
rules below, and the browser console (DevTools → Console) has a
`content: dropped project row …` or `content: dropped career row …` warning
naming the row and the rule.

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

The schema refuses most bad values outright: blank required text, a bad `id`,
`color`, `tech` (an empty array too), `repo`, `start`, `end` or `employment`.
A blank `repo`, `note` or `end` counts as NULL. The site also checks every row
as it loads, including what the schema cannot (an `id` taken by a destination,
a planet, a moon or another scannable, and blank `tech` entries): a row that breaks a rule is dropped,
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
npx wrangler d1 execute fitz-beacons --remote --config beacon-api/wrangler.toml \
  --command "SELECT id, sort, title, color FROM projects ORDER BY sort"
```

### Creating the tables and the first rows

Once, before the site that reads `/content` is released (both are safe to run
again):

```bash
# The two tables
npx wrangler d1 execute fitz-beacons --remote --config beacon-api/wrangler.toml --file=beacon-api/content.sql
# The first rows, identical to the bundled data. INSERT OR IGNORE: running it
# again never overwrites an edit.
npx wrangler d1 execute fitz-beacons --remote --config beacon-api/wrangler.toml --file=beacon-api/content-seed.sql
```

`content-seed.sql` is generated from `src/data/projects.json` and
`src/data/career.ts` (`npm run content:seed`); `tests/contentSeed.test.ts` fails
when it drifts from them. To reset D1 to the bundled copy, empty the tables first
(`DELETE FROM projects; DELETE FROM career;`), then run the seed again.

The bundled files stay the site's fallback: keep them roughly in step with D1
when it matters (offline visitors and a broken database see them), and
`index.html`'s `<noscript>` summary is kept by hand.

## Moderating

Prefer hiding (see "The `hidden` column"): a deleted row no longer counts
toward its pilot's limits.

```bash
# What is up there right now (newest first)
npx wrangler d1 execute fitz-beacons --remote --config beacon-api/wrangler.toml \
  --command "SELECT id, text, hidden, at, country FROM beacons ORDER BY at DESC LIMIT 50"

# Hide one
npx wrangler d1 execute fitz-beacons --remote --config beacon-api/wrangler.toml \
  --command "UPDATE beacons SET hidden = 1 WHERE id = '<id>'"

# Hide a burst (epoch ms)
npx wrangler d1 execute fitz-beacons --remote --config beacon-api/wrangler.toml \
  --command "UPDATE beacons SET hidden = 1 WHERE at > <epoch-ms>"
```

**Kill switch:** empty `VITE_BEACON_API` in `.env.production` and merge. Both
hosts redeploy without the feature, and the data stays in D1.
