# Beacon API

The small Cloudflare Worker behind visitor beacons. A visitor can drop a beacon
where their ship is. Each beacon carries one phrase from a fixed list, and later
visitors see it in space and can scan it.

The site works without this API. With `VITE_BEACON_API` unset, the beacon
feature does not render at all.

## Design

- **No free text, so nothing to moderate.** A beacon stores an index into
  [`src/data/beaconPhrases.ts`](../src/data/beaconPhrases.ts). The Worker
  rejects any other value. That list is append-only: old beacons refer to their
  phrase by position.
- **The same validation runs in two places.** `validateDrop` in
  [`src/utils/beacons.ts`](../src/utils/beacons.ts) checks drops in both the
  client and the Worker. The client also treats the `GET` response as
  untrusted: `parseBeacons` drops malformed rows and caps the list.
- **Rate limit: one beacon per visitor every 10 minutes.** It is keyed on a
  salted SHA-256 of the client IP. The raw IP is never stored, and rotating
  `IP_SALT` makes the existing hashes useless.
- **The table is bounded.** It keeps the newest 500 rows, and `GET` serves the
  newest 40.
- **Writes are limited to listed origins.** A `POST` must come from an origin in
  `ALLOWED_ORIGINS`. CORS grants go only to those origins.
- **Country.** It comes from `CF-IPCountry` and is shown on a scan as
  "PILOT FROM ID". Unknown (`XX`) and Tor (`T1`) are stored as null.

The handler lives in `src/handler.ts` and has no Cloudflare bindings. Its tests
are in [`tests/beaconApi.test.ts`](../tests/beaconApi.test.ts) and run under
the root `npm test`. `src/index.ts` is the thin D1 adapter.

## Deploying

Run these from the repo root. Wrangler is not a dependency of this repo, so
`npx` fetches it on first use. You need a Cloudflare login (`npx wrangler login`).

```bash
# 1. Create the database, and paste its id into beacon-api/wrangler.toml
npx wrangler d1 create fitz-beacons

# 2. Create the table
npx wrangler d1 execute fitz-beacons --remote --file=beacon-api/schema.sql

# 3. Set the salt (any long random string)
openssl rand -hex 32 | npx wrangler secret put IP_SALT --config beacon-api/wrangler.toml

# 4. Set ALLOWED_ORIGINS in wrangler.toml to every host that serves the site,
#    comma-separated, then deploy
npx wrangler deploy --config beacon-api/wrangler.toml
```

Then give the site the Worker's URL, for example
`https://fitz-beacons.<you>.workers.dev`:

- **GitHub Pages:** add a repository *variable* (not a secret, since the URL is
  public) named `VITE_BEACON_API`. `.github/workflows/deploy.yml` passes it to
  the build.
- **Cloudflare:** set `VITE_BEACON_API` in the Workers Builds environment for
  `3d-portfolio`.
- **Local dev:** set it in `.env`.

## Removing a beacon

```bash
npx wrangler d1 execute fitz-beacons --remote \
  --command "DELETE FROM beacons WHERE id = '<id>'"
```

The fixed phrase list leaves little to remove. The likely case is a burst of
beacons dropped as spam from many IPs:

```bash
npx wrangler d1 execute fitz-beacons --remote \
  --command "DELETE FROM beacons WHERE at > <epoch-ms>"
```
