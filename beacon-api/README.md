# Beacon API

The small Cloudflare Worker behind visitor beacons. A visitor can drop a beacon
where their ship is. Each beacon carries one phrase from a fixed list, and later
visitors see it in space and can scan it.

The site works without this API. With `VITE_BEACON_API` empty, the beacon
feature does not render at all.

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
- **Nothing is stored.** No tables, no storage API, no IPs or hashes. A pilot
  is a random id (new every connection), a country from `CF-IPCountry` (`XX`
  and `T1` become null, as with beacons), and their last pose, held in the
  socket's attachment. Closing the socket forgets them.
- **Quiet when alone.** Clients send their pose only while someone else is in
  the room and only when it changes, at most 5 times a second. The room
  snapshots at most every 250 ms, plus one trailing snapshot so a last move is
  never lost. With nobody moving, the room hibernates.
- **Limits.** 40 sockets (the 41st gets `full`, close 1013); messages over 256
  bytes are dropped; more than 10 messages in a second closes the socket (1008).
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

# 2. Create the table
npx wrangler d1 execute fitz-beacons --remote --file=beacon-api/schema.sql

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
