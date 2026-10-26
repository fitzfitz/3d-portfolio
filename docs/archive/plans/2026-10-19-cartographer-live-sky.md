# C2: The Cartographer in the Live Sky Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CARTOGRAPHER title visible to other pilots (PR #37):
- the AURUM plume;
- each pilot's charted count on the wire, shown in ghost scans;
- a once-only shout-out when a pilot charts all five worlds;
- the consent update that covers all of the above.

**Architecture:**
- The shared protocol (`src/utils/liveSkyProtocol.ts`) gains an optional `ch` count and plume coherence. beacon-api imports it, so the Worker and the site validate the same way.
- The room (`beacon-api/src/sky.ts`) relays a `charted` shout-out under in-memory anti-spam rules and stores nothing.
- The client sends `ch`, renders ghost scan text from it, and plays incoming shout-outs on the radio.
- **The Worker is deployed before the site merges.**

**Tech Stack:** TypeScript, React 19 / R3F, zustand, a Cloudflare Durable Object (hibernatable WebSockets), vitest, and puppeteer e2e probes (fake sky socket).

**Spec:** `docs/archive/specs/2026-10-17-new-worlds-design.md`, sections "Charting, logbook and title (local)" (the plume parts) and "Live sky (the visible title)". C1 already shipped local charting, the logbook section, the system chart and the local title (`src/utils/charting.ts`, `spaceStore.charted`, `chartWorld`).

## Global Constraints

- **`ch`:** an optional integer 0–5 on `me`. Absent means 0, and malformed or out-of-range values are coerced to 0, never rejected. `CHART_TOTAL = 5` lives in `liveSkyProtocol.ts`.
- **Byte-identical rows:** `buildSnap` emits `ch` only when it is above 0, so existing rows stay byte-identical.
- **Plume coherence:** `plume: "cartographer"` is accepted only with `ch === 5` in the same message. Otherwise it is coerced to `"stock"`. The client applies the same rule to incoming rows.
- **Plume:** id `cartographer`, name `AURUM`, hex `#ffe9a3`. Its locked label reads "Chart all 5 worlds".
- **Ghost scan text:**
  - `ch` 5: `CARTOGRAPHER · <cc>`
  - `ch` 1–4: `<ch>/5 CHARTED · <cc>`
  - `ch` 0: today's `PILOT FROM <cc> · LIVE` / `PILOT · LIVE`
- **Shout-out:**
  - The client sends `{t:"charted"}` once, when its count first reaches 5. A pending flag lets it go out on a later connection within 24 h.
  - The room relays `{t:"charted", cc}` to everyone else only when all of these hold: a `me` was seen; `last.ch === 5`; this connection hasn't announced (attachment flag `announced`); this visitor key hasn't announced within 24 h (in memory); and at least 60 s have passed since the room's last shout-out.
- **Nothing stored server-side.** Anti-spam lives in Durable Object memory, and a hibernated room may forget it (best effort).
- **Hibernation:** old attachments are tolerated (`ch ?? 0`, `announced ?? false`).
- **Consent:** the notice, the logbook toggle and `beacon-api/README.md` mention the charted count. The "seen" flag is versioned so returning pilots see the updated notice once. No new identifier is added; the country still comes only from `CF-IPCountry`.
- **The worst-case `me` message must stay ≤ 256 bytes** (`MAX_MESSAGE_BYTES`; the spec estimates ~104).
- **Deploy order:** `npx wrangler deploy --config beacon-api/wrangler.toml`, run by the controller **only after the owner says so**, before the site PR merges.
- **Changelog:** a new entry with `pr: 37`. Title ≤ 4 words; what/why ≤ 220 characters; how ≤ 240.
- **Subagents** must not install packages, kill processes by name, push or deploy.

## Review Focus

1. **An old cached client (no `ch`, unaware of `charted`) talking to the new Worker** stays visible, and its ghost shows today's text. Covered in Task 2 (`parseMe` without `ch` gives 0).
2. **A malformed `ch`** (`"5"`, `5.5`, `-1`, `99`, `null`) becomes 0 and never hides the pilot. Covered in Task 2.
3. **Shout-out spam:**
   - a reconnect loop from one visitor relays once per 24 h;
   - two pilots finishing in the same minute relay once;
   - a claim without `ch: 5` relays nothing.

   Covered in Task 3.
4. **A room woken from hibernation with attachments written before C2** (no `announced`, `last` without `ch`) doesn't crash, and its snapshots omit `ch`. Covered in Task 3.
5. **A pilot who reaches 5/5 while alone or with live sky off** sends the shout-out once on a later connection within 24 h and never after that. Covered in Task 5.

---

### Task 1: The AURUM plume

**Files:**
- Modify: `src/data/plumeColors.ts`, `src/utils/logbook.ts:92-96` (`plumeAllowed`), `src/components/layout/PlumePicker.tsx:18-25`, and every caller of `plumeAllowed` (grep).
- Test: `tests/plumeColors.test.ts`, `tests/hangar.test.ts`, `tests/charting.test.ts`.

**Interfaces:**
- Produces:
  - `PLUME_COLORS.cartographer = { name: "AURUM", hex: "#ffe9a3" }`.
  - `plumeAllowed(id: string, p: LogbookProgress, hasColour: (id: string) => boolean, charted: readonly ChartRecord[] = []): boolean`. `"cartographer"` is allowed exactly when `isCartographer(charted)`.

- [ ] **Step 1: Write the failing tests:**
  - `plumeColors`: `PLUME_COLORS.cartographer` is `{ name: "AURUM", hex: "#ffe9a3" }`, and it differs from slingshot's `#ffc23d`. The existing unique-hex test still passes.
  - `charting.test.ts`, "the cartographer plume unlocks with all five worlds charted":
    - `plumeAllowed("cartographer", emptyProgress, hasPlumeColour, [])` is `false`.
    - The same call with five `ChartRecord`s (one per `WorldId`) is `true`.
    - With four it is `false`.
  - `hangar.test.ts`: the cartographer card's locked aria-label is `"AURUM plume, locked: chart all 5 worlds"` and its title is `"Chart all 5 worlds to unlock"`.
- [ ] **Step 2:** Run `npx vitest run tests/plumeColors.test.ts tests/charting.test.ts tests/hangar.test.ts`. Expected: the new assertions FAIL.
- [ ] **Step 3: Implement.** Pass `useSpaceStore` `charted` to every `plumeAllowed` caller. A stored `plumeColor` of `cartographer` that is no longer allowed falls back the same way any locked plume does today.
- [ ] **Step 4:** Re-run. Expected: PASS. Then run `npx vitest run`: all pass.
- [ ] **Step 5: Commit**: `feat(plume): AURUM, unlocked by charting all five worlds`.

### Task 2: Protocol: `ch`, plume coherence, the `charted` messages

**Files:**
- Modify: `src/utils/liveSkyProtocol.ts`.
- Test: `tests/liveSkyProtocol.test.ts`.

**Interfaces:**
- Consumes: `hasPlumeColour("cartographer")` (Task 1).
- Produces:
  - `export const CHART_TOTAL = 5`.
  - `ShipState` becomes `{ p: Vec3; q: Quat; plume: string; ch: number }`.
  - `SnapShip` gains an optional `ch?: number` on the wire.
  - `ServerMessage` gains `| { t: "charted"; cc: string | null }`.
  - `parseMe(raw): ShipState | null`, which now returns `ch` and applies coherence.
  - `export function chartCount(v: unknown): number`: an integer 0–5, otherwise 0.
  - `export function isChartedClaim(raw: unknown): boolean`: a string of ≤ `MAX_MESSAGE_BYTES` that parses to `{ t: "charted" }`.
  - `roundState` copies `ch`, and its default `out` has `ch: 0`.

- [ ] **Step 1: Write the failing tests:**
  - `parseMe` without `ch` returns `ch: 0`.
  - `ch: 3` gives 3.
  - Each of `"5"`, `5.5`, `-1`, `99` and `null` gives `ch: 0` and the pilot is still parsed (not null).
  - `plume: "cartographer"` with `ch: 5` stays `"cartographer"`.
  - With `ch: 4`, and with no `ch`, the plume becomes `"stock"`.
  - The worst-case `me` (max-length coordinates such as `-479.99`, 4-decimal quaternion, `plume: "cartographer"`, `ch: 5`) encodes to ≤ 256 bytes and parses.
  - `isChartedClaim('{"t":"charted"}')` is `true`. It is `false` for `'{"t":"me"}'`, for non-strings and for oversize input.
- [ ] **Step 2:** Run `npx vitest run tests/liveSkyProtocol.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the signatures above.
- [ ] **Step 4:** Run `npx vitest run` and `npx tsc -b`. Expected: PASS and clean. Fix any callers `tsc` flags: `ShipState` now needs `ch`.
- [ ] **Step 5: Commit**: `feat(live-sky): charted count and plume coherence on the wire`.

### Task 3: Room: `ch` in snapshots and the shout-out relay

**Files:**
- Modify: `beacon-api/src/sky.ts`; `beacon-api/src/index.ts` (restore defaults, and dispatching the claim through `onMessage`).
- Test: `tests/skyRoom.test.ts`, `tests/skyAdapter.test.ts`.

**Interfaces:**
- Consumes: `isChartedClaim`, `CHART_TOTAL`, the `ch` on `ShipState` (Task 2).
- Produces:
  - `Pilot` gains `announced?: boolean`.
  - `Room` gains `lastShoutAt: number` (initially `-Infinity`) and `shouted: Map<string, number>` (visitor key to ms).
  - `export const SHOUT_GAP_MS = 60_000` and `export const SHOUT_VISITOR_MS = 24 * 60 * 60 * 1000`.
  - `onMessage` handles a charted claim, after the flood check and before `parseMe`. When the rules hold it returns `out` with `{ t: "charted", cc: pilot.cc }` for every *other* pilot, and sets `announced`, `lastShoutAt` and `shouted[visitor]`. A claim never triggers a snapshot.
  - `buildSnap` emits `ch` only when `(p.last.ch ?? 0) > 0`.

- [ ] **Step 1: Write the failing tests** in `skyRoom.test.ts`, describe "charted shout-out":
  - "relays to the others, not the sender": two pilots, A sent `me` with `ch: 5`. A's claim produces exactly one Outgoing, to B, `{ t: "charted", cc: A.cc }`.
  - "needs a me with ch 5": a claim before any `me`, or after a `me` with `ch: 4`, gives `out: []`.
  - "once per connection": a second claim from A gives `[]`.
  - "once per visitor per 24 h": A leaves, and a new pilot with the same visitor key sends `ch: 5` and a claim after the 60 s gap. The claim gives `[]`. Past 24 h it relays.
  - "a 60 s room-wide gap": a different visitor C sends a claim 10 s after A's. It gives `[]`. At 61 s it relays.
  - "claims count toward the flood limit": eleven claims inside 1 s close the socket.
  - "snapshots carry ch only when above 0": a pilot with `ch: 0` has no `ch` key in the snapshot row, and `ch: 2` gives `ch: 2`.
  - "a pre-C2 attachment": a `Pilot` restored without `announced`, with a `last` that has no `ch`. `buildSnap` omits `ch` and a claim is handled (gives `[]`, since `ch` isn't 5) without throwing.

  In `skyAdapter.test.ts`, a socket restored from an attachment without `announced` delivers a later valid shout-out.
- [ ] **Step 2:** Run `npx vitest run tests/skyRoom.test.ts tests/skyAdapter.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `index.ts`, the restore path leaves missing fields to the `?? defaults` in `sky.ts`. Keep the "nothing stored" design: `shouted` lives on the `Room` object only.
- [ ] **Step 4:** Run `npx vitest run` and `npx tsc -b`. Expected: PASS and clean.
- [ ] **Step 5: Commit**: `feat(sky): charted count in snapshots; a once-only shout-out relay`.

### Task 4: Client: reading `ch` and ghost scan text

**Files:**
- Modify: `src/utils/liveSky.ts` (`parseShip`, `parseServerMessage`, `GhostPose`, `GhostBuffer.push`, `ghostRegistry`, `ghostReport`), `src/components/canvas/Ghosts.tsx:165` (registry write), `src/utils/scanReport.ts:38-39`.
- Test: `tests/liveSky.test.ts`, `tests/scanReport.test.ts`.

**Interfaces:**
- Consumes: `chartCount`, `CHART_TOTAL` (Task 2).
- Produces:
  - `GhostPose.ch: number`.
  - `ghostRegistry: Map<string, { cc: string | null; ch: number }>`.
  - `ghostReport(cc: string | null, ch: number): string`.
  - `parseServerMessage` returns `{ t: "charted", cc }` with `cc` passed through `publicCountry`.

- [ ] **Step 1: Write the failing tests:**
  - `parseServerMessage` with a snapshot row holding `ch: 5` and `plume: "cartographer"` keeps both. With `ch: 2` and `plume: "cartographer"` the plume becomes `"stock"`. With `ch: "x"` it gives `ch: 0`.
  - `'{"t":"charted","cc":"ID"}'` gives `{ t: "charted", cc: "ID" }`, and `cc: "XX"` gives `cc: null`.
  - `ghostReport` returns:
    - `("ID", 5)`: `"CARTOGRAPHER · ID"`
    - `("ID", 3)`: `"3/5 CHARTED · ID"`
    - `("ID", 0)`: `"PILOT FROM ID · LIVE"`
    - `(null, 0)`: `"PILOT · LIVE"`
    - `(null, 5)`: `"CARTOGRAPHER · LIVE"` (*plan ruling*: "LIVE" stands in for the unknown country, as it does today)
    - `(null, 2)`: `"2/5 CHARTED · LIVE"`
  - `GhostBuffer.push` updates `pose.ch` on later snapshots.
- [ ] **Step 2:** Run `npx vitest run tests/liveSky.test.ts tests/scanReport.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. The `Ghosts.tsx` registry write sets `{ cc: g.cc, ch: g.ch }`.
- [ ] **Step 4:** Run `npx vitest run` and `npx tsc -b`. Expected: PASS and clean.
- [ ] **Step 5: Commit**: `feat(live-sky): ghost scans show charted count and the title`.

### Task 5: Client: sending `ch`, the pending shout-out, playing incoming ones

**Files:**
- Modify: `src/utils/liveSky.ts` (`SendState`, `shouldSend`, `markSent`), `src/utils/liveSkyConnection.ts` (`tick`, `receive`, options), `src/utils/charting.ts`, `src/store/spaceStore.ts` (`chartWorld`, a new persisted field), `src/components/canvas/Ghosts.tsx:127-131`.
- Test: `tests/liveSky.test.ts`, `tests/liveSkyConnection.test.ts`, `tests/charting.test.ts`.

**Interfaces:**
- Consumes: Tasks 2 and 4.
- Produces, in `charting.ts`:
  - `export const SHOUT_PENDING_MS = 24 * 60 * 60 * 1000`.
  - `export function shoutDue(pendingAt: number | null, now: number): boolean`: true when `pendingAt !== null && now - pendingAt < SHOUT_PENDING_MS`.
  - `export const shoutLine = (cc: string | null): string`, giving `"A PILOT FROM <cc> HAS CHARTED EVERY WORLD. A NEW CARTOGRAPHER FLIES."` or `"A PILOT HAS CHARTED EVERY WORLD. A NEW CARTOGRAPHER FLIES."`.

  In the store: `chartShoutAt: number | null`, persisted as `fitz-charted-shout`. `chartWorld` sets it to `Date.now()` on the call that first makes `isCartographer` true. Also `clearChartShout(): void`.

  In `LiveSkyConnection`:
  - The constructor option `onCharted?: (cc: string | null) => void` is called from `receive` for `{t:"charted"}`.
  - `tick(me: ShipState | null, shout = false): boolean` sends `{"t":"me",…, "ch":n}` (with `ch` only when > 0). When `shout` is true and this tick sent a `me` with `ch === CHART_TOTAL`, it then sends `{"t":"charted"}` and returns `true`.

  `SendState` gains `lastCh`, and a `ch` change makes `shouldSend` true.

  `Ghosts.tsx` sets `me.ch = Math.min(s.charted.length, CHART_TOTAL)`. It passes `shout = shoutDue(s.chartShoutAt, Date.now())` and calls `clearChartShout()` when `tick` returns true. `onCharted` calls `announceLogbook(shoutLine(cc))`.

- [ ] **Step 1: Write the failing tests:**
  - `shoutDue(null, t)` is `false`; `shoutDue(t, t + 1000)` is `true`; `shoutDue(t, t + SHOUT_PENDING_MS)` is `false`.
  - `shouldSend` is true when only `ch` changed.
  - The connection, against a fake socket with peers > 0:
    - `tick({..., ch: 5}, true)` sends a `me` then `{"t":"charted"}` and returns `true`;
    - `tick({..., ch: 4}, true)` sends no claim and returns `false`;
    - a `ch: 0` `me` has no `ch` key;
    - a received `{"t":"charted","cc":"ID"}` calls `onCharted("ID")`.
  - Store, "charting the fifth world arms the shout-out once": `chartShoutAt` is set by the fifth `chartWorld`, not by the fourth. Re-charting doesn't move it, and `clearChartShout` resets it to `null` and persists that.
- [ ] **Step 2:** Run `npx vitest run tests/charting.test.ts tests/liveSky.test.ts tests/liveSkyConnection.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run` and `npx tsc -b`. Expected: PASS and clean.
- [ ] **Step 5: Commit**: `feat(live-sky): share the charted count; announce a new cartographer once`.

### Task 6: Consent update

**Files:**
- Modify: `src/utils/liveSky.ts:20` (`LIVE_SKY_NOTICE`), `src/store/spaceStore.ts:528,616-623` (the seen-flag key), `src/components/layout/LogbookPanel.tsx:126-138` (the description), `beacon-api/README.md:55-90`, and `tests/e2e/livesky.probe.mjs` (wherever it hardcodes the notice or seen key).
- Test: `tests/liveSkySettings.test.ts`.

**Interfaces:**
- Produces:
  - `LIVE_SKY_NOTICE = "LIVE SKY // OTHER PILOTS CAN SEE YOUR SHIP, PLUME, COUNTRY AND WORLDS CHARTED. TOGGLE IN THE LOGBOOK (L)"`.
  - The seen flag moves to `fitz-live-seen-2`. The old `fitz-live-seen` is ignored, so returning pilots see the new notice once before anything is sent.
  - The logbook description reads `"See other pilots flying now. They see your ship, plume, country and worlds charted."`.

- [ ] **Step 1: Write the failing test** in `liveSkySettings.test.ts`, "a pilot who saw the old notice sees the new one": with only `fitz-live-seen = "1"` in storage, the store's `liveSkySeen` is `false`. `setLiveSkySeen(true)` writes `fitz-live-seen-2`.
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3: Implement.** In `beacon-api/README.md`:
  - Add the charted count to what a pilot shares.
  - Describe the shout-out (relayed, never stored).
  - Say its anti-spam lives in memory only.
  - Keep "Nothing is stored." as it is.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(live-sky): consent notice covers the charted count; re-shown once`.

### Task 7: e2e: the live-sky probe covers C2

**Files:**
- Modify: `tests/e2e/livesky.probe.mjs`.

**Interfaces:**
- Consumes: the fake sky socket (`installFakeSky`, `__fakeSky.serve`). If the fake doesn't already record client sends, add a `sent` array to it.

- [ ] **Step 1: Add checks**, named exactly:
  - `a cartographer's pose carries ch 5 and the AURUM plume`: seed `fitz-charted` with all five worlds and `fitz-charted-shout` with `Date.now()`, select the cartographer plume, add company, and read the sent `me`.
  - `the shout-out is sent once`: exactly one `{"t":"charted"}` across several ticks.
  - `a charted ghost scans as CARTOGRAPHER · ID`: serve a row with `ch: 5` and `cc: "ID"`, then scan it.
  - `a shout-out from the room plays on the radio`: serve `{t:"charted", cc:"ID"}`, and the radio shows `shoutLine("ID")`.
- [ ] **Step 2:** Run `npm run test:e2e -- livesky`. Expected: every check passes, old and new.
- [ ] **Step 3: Commit**: `test(e2e): live sky probe covers the charted count, the plume and the shout-out`.

### Task 8: Patch note, docs, plume check, PR, deploy

- [ ] **Step 1: Changelog.** Add `{ id: "2026-10-19-cartographer-live-sky", date: "2026-10-19", pr: 37, title: "Cartographers Fly Gold" ... }`:
  - what: AURUM plume, charted count in scans, shout-out;
  - why: the title was only visible to yourself;
  - how: an optional count on the wire, coherence checked by the room, anti-spam in memory, nothing stored.

  Remove the C2 item from `docs/FOLLOW-UPS.md`. Run `npx vitest run tests/changelog.test.ts`. Expected: PASS.
- [ ] **Step 2: Plume check (controller, real browser).** Screenshot the AURUM plume and the GOLD plume under bloom, side by side, for the owner. They must read clearly apart. If not, tune the hex and record it.
- [ ] **Step 3:** Run `npx vitest run`, `npx tsc -b`, `npx oxlint src tests beacon-api` and `npm run test:e2e`. Expected: all green. Commit.
- [ ] **Step 4: Open PR #37** (push as fitzfitz). Its body states that **the beacon-api deploy comes before merge**. Do not merge.
- [ ] **Step 5: Ask the owner for the go-ahead to deploy beacon-api.** On a yes, the controller runs `npx wrangler deploy --config beacon-api/wrangler.toml`. Then verify against the live Worker with a small Node WebSocket script:
  - two sockets join the room;
  - one sends `me` with `ch: 5` and the cartographer plume;
  - the other's snapshot row carries `ch: 5` and `plume: "cartographer"`;
  - a claim relays `{t:"charted"}` to the other socket.

  Record the deployed version id in the PR. Merge only when the owner says so.
