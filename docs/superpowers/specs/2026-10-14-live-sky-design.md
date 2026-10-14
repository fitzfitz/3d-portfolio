# Live sky

**Date:** 2026-10-14 · **Branch:** `feat/live-sky` · **Status:** approved in brainstorming, awaiting spec review

## 1. Intent

The universe feels alive, but the visitor is always alone in it. Live sky shows the other people who are flying right now as faint ghost ships. It is **ambient presence only**: the point is "you're not the only one here", not interaction.

**Decisions from brainstorming**

- **Strictly live.** A ghost is always a real person who is there now. An empty sky stays empty; there are no replays and no visitor counts.
- **A ghost shows plume colour and country.** The plume is the colour its pilot unlocked in the logbook. The country appears only when you scan the ghost.
- **Visible by default, easy opt-out.** A one-time radio notice comes before anything is sent. A toggle in the logbook turns the feature off, and opting out also hides everyone else from you.
- **Approach:** a single Durable Object room over hibernatable WebSockets, inside the existing `beacon-api` Worker. Polling (choppy, and it eats the beacon request budget) and WebRTC (exposes IPs to peers) were rejected.

**Success criteria**

1. Two people flying at the same time see each other move smoothly, with no visible jumps between updates.
2. A visitor who is alone sends nothing after connecting, and the room hibernates.
3. Nothing about a pilot is stored. There are no tables, IPs or hashes, and closing the tab removes the ghost.
4. No new WebGL shader programs (the deep-space programs probe stays at 79/79), and no React renders per frame.
5. The site keeps working if the Worker is down, over quota or switched off; the visitor is simply alone.
6. It runs inside the Workers Free plan at portfolio traffic (see §7).

**Out of scope:** gestures, chat or any interaction; replays or "recent visitors"; visitor counts in the HUD; ghosts on the classic résumé; sharding into more than one room; names or persistent pilot identity.

## 2. Server: the `Sky` Durable Object (`beacon-api/`)

### 2.1 Routing (`beacon-api/src/index.ts`)

- New route `GET /live`, a WebSocket upgrade. Anything other than a GET with `Upgrade: websocket` gets 426.
- **Origin check:** the `Origin` header must be in `ALLOWED_ORIGINS` (the same list beacons use), otherwise 403. As in the beacon README, this stops other websites embedding the feed; it is not abuse protection.
- **Request budget:** each upgrade attempt spends one `LIMITER` token, keyed exactly like beacons with `rateKey(ip)` (the IPv4 address, or the IPv6 /64). Over budget gets 429. The key goes only to the rate limiter; it is never stored or passed to the room.
- The Worker forwards the request to `env.SKY.getByName("sky")`, along with the `CF-IPCountry` value. Everyone shares that one room.
- The existing `/beacons` routes are unchanged.

### 2.2 Room state

- The room accepts sockets with `ctx.acceptWebSocket(server)` (the hibernation API) and never calls `ws.accept()`.
- Each socket's attachment (`serializeAttachment`) holds:
  - `id`: a random 8-character id, new on every connection, never derived from the IP or anything stable;
  - `cc`: a two-letter country, or `null` for `XX`, `T1` or a missing header (the same rule as beacons);
  - `last`: the last valid state `{ p, q, plume }`, or `null` if the pilot has not sent any yet;
  - `win`: `{ start, count }` for the message flood limit (§2.4).
- The constructor rebuilds nothing from storage: the DO uses no storage API and declares no SQL tables. After hibernation, `ctx.getWebSockets()` plus attachments are the whole state.
- **Cap:** 40 open sockets. Socket 41 receives `{t:"full"}` and is closed with code 1013. Its client stays solo and does not retry until the next page load.

### 2.3 Pure room logic (`beacon-api/src/sky.ts`)

This is free of Cloudflare bindings, like `handler.ts`, so it can be unit tested. It exports functions that take the current pilots and an event and return what to send to whom:

- `onJoin(pilots, newcomer)`: the newcomer gets `hello`, plus an immediate `snap` of everyone already present; every other pilot gets `peers` and `{t:"sync"}`, asking it to send one `me` even if it is still (see §3.2).
- `onMessage(pilots, sender, raw, now)`: validates the message (§2.4), updates the sender's `last`, and returns a `snap` broadcast if one is due under the throttle.
- `onLeave(pilots, leaver)`: `peers` plus one `snap` to everyone who remains.
- `buildSnap(pilots, forId)`: every pilot with a `last`, except `forId` itself.

The DO class in `index.ts` is a thin adapter around this.

**No repeating timers.** Snapshots are driven by incoming `me` messages and throttled to one per 250 ms room-wide (`lastSnapAt` lives in memory; after hibernation the next message simply broadcasts). A `me` that arrives inside the throttle window schedules **one** trailing snapshot for the end of the window, so a pilot's last move before stopping is never lost; further messages in that window do not schedule more. A pilot who is not moving sends nothing, and their ghost correctly stays where it is.

### 2.4 Validation

A `me` message is accepted only if all of these hold:

- the payload is a string of at most 256 bytes that parses as JSON with `t === "me"`;
- `p` has three finite numbers, each within `±COSMIC_BOUNDS` (positions are already wrapped into the world);
- `q` has four finite numbers whose squared length is between 0.9 and 1.1; the server normalises it;
- `plume` is `"stock"` or a key of `PLUME_COLORS` (imported from `src/data/plumeColors.ts`, as `handler.ts` imports `src/utils/beacons.ts`). The server cannot check that the pilot really unlocked it, but a spoofed plume is cosmetic and harmless.

Any invalid message is dropped silently. **Flood limit:** more than 10 messages in any one-second window closes the socket with code 1008. A well-behaved client sends at most 5 a second.

## 3. Protocol

All messages are small JSON objects. Numbers are rounded before sending: positions to 0.01, quaternion components to 0.001.

### 3.1 Server to client

| Message | When | Body |
|---|---|---|
| `hello` | on connect | `{t:"hello", id, peers}`, where `peers` is the number of *other* pilots |
| `peers` | someone joins or leaves | `{t:"peers", n}` |
| `sync` | someone else joins | `{t:"sync"}`: send one `me` now |
| `snap` | throttled, on `me`, a leave, or a join (to the newcomer) | `{t:"snap", ships:[{id, p:[x,y,z], q:[x,y,z,w], plume, cc, ago}]}`, never including your own ship. `ago` is how old (ms) the pose was when the room sent it; a pilot not heard from for 60 s (`STALE_MS`) is left out, since their connection has likely died without a close |
| `full` | the room is at its cap | `{t:"full"}`, then the socket closes |

### 3.2 Client to server

`{t:"me", p:[x,y,z], q:[x,y,z,w], plume}`, sent only when **all** of these are true:

- `peers > 0`, so a visitor who is alone sends nothing;
- the ship has moved more than 0.05 u or turned more than 1° since the last send, **or** a `sync` arrived since the last send;
- at least 200 ms have passed since the last send (at most 5 a second).

A still pilot in company also re-sends every 20 s (`KEEPALIVE_MS`), so the room can tell them from a dead connection. A solo pilot still sends nothing.

## 4. Client

### 4.1 Pure model (`src/utils/liveSky.ts`)

- `parseServerMessage(raw): ServerMessage | null`: snapshots are untrusted input. Each ship has its position clamped to `±COSMIC_BOUNDS` and its quaternion normalised (rejected if degenerate). Unknown plumes become `"stock"`; anything that isn't a two-letter `[A-Z]{2}` becomes a `null` country. The list is capped at 40, and invalid rows are dropped rather than failing the whole message.
- `GhostBuffer`: keeps the last snapshots per ghost id, each timed by when the pose was sent (arrival minus `ago`, so no clock sync is needed; timing by arrival would alias the 200 ms sends against the 250 ms snapshots into a lurch). It renders 500 ms (two snapshot intervals) in the past, blending positions linearly with `wrapDelta` so a ghost crossing the wrap seam does not streak across the world, and rotations with slerp. If no newer snapshot exists it holds the last pose (no extrapolation). After a gap of more than 1 s (the ghost sat still) it holds the old pose until just before the new one, so a ghost that starts moving glides off rather than jumping. Ids this page flew under before a reconnect are never shown. A ghost missing from a snapshot is removed, and an id seen for the first time fades in over 0.5 s.
- `nearestGhosts(ship, ghosts, n = 8)`: sorted by `toroidalDistance3`.
- `shouldSend(state, now)`: the rule in §3.2, as a pure function.
- `liveSkyUrl()`: reads `VITE_LIVE_SKY`; dev builds also accept a `fitz-live-sky-dev` localStorage override, stripped from production exactly like `beaconApiUrl()`.

### 4.2 Connection (`src/utils/liveSkyConnection.ts`)

A small class, not React state. It holds the socket, the `GhostBuffer`, `peers` and the send state. The scene reads it per frame through a ref.

- **When to connect:** only when all of these are true: `liveSkyUrl()` is non-empty, the visitor is in the 3D scene (never the classic résumé), the ship has flown at least once (`hasFlown`), live sky is enabled, and the first-time notice has played (§5).
- **Reconnects:** back off with jitter from 2 s, doubling to 60 s, and reset after a connection lasts 30 s. A `full` stops retries until the next page load. A failed upgrade (over quota, 429, Worker down) is just another backoff step, with no user-visible error.
- **Hidden tab:** disconnect after the tab has been hidden for 60 s, and reconnect when it becomes visible again.
- **Toggle off:** close the socket, clear the buffer, remove ghost scannables, and stop all sending.

### 4.3 Rendering (`src/components/canvas/Ghosts.tsx`)

- Up to 8 ghost hulls from `nearestGhosts`, each placed at its pose from the `GhostBuffer`, offset by `wrapDelta` from the pilot's ship so it appears at its nearest wrapped copy.
- **Look:** the ship model as an additive wash in the ghost's plume colour, with one short, steady plume on the centre nozzle (no thrust response: ghosts send no throttle). No collisions, gravity, tractor beam, sound, engine light or particles.
- **Program budget:** the wash uses exactly the parameters of RingCourse's race-ghost material (`MeshBasicMaterial`, additive, transparent, `depthWrite: false`, `toneMapped: false`), and the plume uses `makePlumeMaterial`, so both hit programs that are already compiled; per-ghost differences are colour, opacity and uniforms only. The e2e probe checks that ghosts appearing add no program, and the deep-space probe stays at 79/79.
- One `useFrame`, no React state updates per frame; the eight mesh slots are pooled and shown or hidden.
- Mounted only when `liveSkyUrl()` is non-empty, so a build without the URL contains no ghost code path that runs.

### 4.4 Scanning

Each visible ghost registers a scannable through `setScannable("ghost:<id>", …)` and removes it when it leaves. A completed scan reports `PILOT FROM <CC> · LIVE`, or `PILOT · LIVE` when the country is null. Scanning a ghost does not count towards the comet badge or any other logbook entry.

## 5. Consent and settings (`src/store/spaceStore.ts`, `LogbookPanel.tsx`)

- `liveSky: boolean`, persisted as `fitz-live-sky`, default `true`.
- `liveSkySeen: boolean`, persisted as `fitz-live-seen`.
- **First-time notice:** at the moment the client would first connect, and only while the HUD is on screen (not in photo mode), if `liveSkySeen` is false, it calls `announceLogbook("LIVE SKY // OTHER PILOTS CAN SEE YOUR SHIP, PLUME AND COUNTRY. TOGGLE IN THE LOGBOOK (L)")`, sets `liveSkySeen`, and only then connects. `announceLogbook` queues the line, so it may reach the screen a moment after the socket opens. That is fine: opening the socket shares nothing, and the client holds its first `me` (the only message that carries ship, plume or position) until the radio has shown the line. In §4.2, "the notice has played" therefore means *queued*; the first `me` waits for *shown*. A notice that reaches the radio while the HUD is unmounted (photo mode) does not count: it is queued again once the HUD is back.
- **Logbook toggle:** the logbook panel gets a "Live sky" on/off switch with a one-line explanation ("See other pilots flying now. They see your ship, plume and country."). It is keyboard, gamepad and screen-reader reachable like the panel's other controls.
- Reduced motion: ghosts still appear; the fade-in becomes instant.

## 6. Testing

### 6.1 Unit (Vitest)

- `tests/skyRoom.test.ts` (`beacon-api/src/sky.ts`): join sends `hello`, `peers` and `sync` to the right pilots; the 41st join is refused with `full`; every validation rule in §2.4 rejects a bad message; the flood limit trips at message 11 in a second; snapshots are throttled to 250 ms; no snapshot includes the recipient; a leave produces `peers` plus a final `snap`; a pilot with no `last` is left out of snapshots.
- `tests/liveSky.test.ts`: the parser (clamping, normalising, dropping bad rows, the 40 cap, unknown plume to stock, bad country to null); the `GhostBuffer` (blending, holding the last pose, removal, wrap-seam blending); `nearestGhosts`; `shouldSend` (silent when alone, motion thresholds, `sync`, 200 ms spacing); `liveSkyUrl` empty means disabled.
- `tests/liveSkyConnection.test.ts`, with a fake WebSocket: the connection gates (résumé, toggle off, notice not played); the backoff sequence and its reset; `full` stopping retries; disconnecting when the tab is hidden; toggle off clearing everything.
- `tests/changelog.test.ts` already enforces the new entry's format and PR number.

### 6.2 End-to-end: `tests/e2e/liveSky.probe.mjs` (registered in `run.mjs`)

The dev localStorage override points at `fake://sky`, and a dev-only fake WebSocket injected into the page plays scripted server messages. The probe checks that:

1. nothing connects before the ship has flown and the notice has played;
2. with `peers: 0`, the client sends nothing;
3. two scripted ghosts appear and move between snapshots without jumps;
4. scanning a ghost shows `PILOT FROM ID · LIVE`;
5. turning the toggle off removes the ghosts and closes the socket;
6. ghosts appearing add no shader program (the count is the same before and after).

### 6.3 Real pass before the PR

`npx wrangler dev --config beacon-api/wrangler.toml` with two real browser tabs (Playwright MCP): both ghosts visible and smooth, a third tab joining while the others are still sees them straight away (the `sync` path), and closing a tab removes its ghost.

### 6.4 Verification bar

`npm test`, `npm run lint`, `npm run build` and `npm run test:e2e` pass, plus the real two-tab pass in §6.3.

## 7. Cost on the Workers Free plan

Checked against Cloudflare's pricing page on 2026-10-14: 100,000 requests a day, 13,000 GB-s of duration a day, incoming WebSocket messages billed at 20:1, outgoing messages free, and no duration billed while a Durable Object is hibernating.

- **A solo visitor:** one upgrade request, then silence. The room hibernates.
- **Two pilots flying together:** at most 5 `me` a second each, about 900 billed requests per pilot per hour. The free tier covers roughly 110 pilot-hours of overlap a day.
- **Duration:** the room is awake only while messages flow. Even awake all day at 128 MB it would use about 11,000 GB-s, under the 13,000 limit.
- **Over quota:** the free plan fails further operations instead of billing. Upgrades and messages then fail, and the client backs off and stays solo (§4.2).

## 8. Deployment and docs

- `beacon-api/wrangler.toml`: a Durable Object binding `SKY` for class `Sky`, and a migration with `new_sqlite_classes = ["Sky"]` (the free plan requires the SQLite backend even though the class stores nothing). The plan confirms the exact syntax against the current Wrangler docs before writing it.
- `.env.production`: `VITE_LIVE_SKY=wss://fitz-beacons.fitzgeralmedia.workers.dev/live`. **Kill switch:** empty it and merge, as with beacons.
- `beacon-api/README.md`: a "Live sky" section covering the design (no storage, random per-connection ids, country from `CF-IPCountry`, the cap, the flood limit), deploying, the kill switch and the cost notes from §7.
- `src/data/changelog.ts`: an entry for PR #20 (the next free number, confirmed when the PR is opened), with visitor-facing what, why, when and how, including what is shared and how to turn it off.

## 9. Risks

- **Translucent ghosts compile a new program.** Mitigation: the opaque, dimmed fallback in §4.3, and the probe gate.
- **Free-tier quota during a traffic spike.** Ghosts stop appearing for the rest of the UTC day; nothing else breaks. The README notes that the Workers Paid plan removes the ceiling.
- **Clock and network jitter cause stutter.** Poses are timed by their age at send (`ago`), and the 500 ms render delay leaves room for one late snapshot; no clock sync is needed.
- **A connection dies without a close.** The pilot drops out of snapshots after 60 s of silence (still pilots in company keep alive every 20 s). A full ping/pong eviction was not added, because it would make solo visitors send traffic.
- **Privacy.** A country is live location data on someone who is on the page right now. Mitigations: the notice comes before the first send, the opt-out is one toggle, nothing is stored, and ids change on every visit. The patch notes say what is shared.
- **A red Cloudflare check on the PR.** The Workers Builds check fails on every PR branch for config reasons, not code; `main` deploys fine. Do not chase it.
- **The country reaches the room before consent.** The Worker forwards `CF-IPCountry` when the socket opens, but the room only ever sends it out inside a `snap`, and a pilot appears in a `snap` only after their first `me`. So nothing about a pilot is shared before the notice has been shown.
