# Messages in bottles: implementation plan

> **For agentic workers:** use superpowers:subagent-driven-development, task by task.

**Goal:** replace the fixed-phrase beacons with free-text messages in bottles: filtered, auto-published, at most 30 visible, with a visitor show/hide setting.

**Spec:** `docs/superpowers/specs/2026-10-26-message-bottles-design.md`

## Global constraints
- The Worker is the filter authority. The client mirrors it from the same module.
- Text is only ever rendered as plain text.
- **D1:** keep the `beacons` table. Add `text` and `hidden`, and keep `phrase`. The new Worker must work with the old site, and the old `{phrase}` POST must keep working.
- **No remote actions:** no wrangler deploy, no `--remote`, no push. Any beacon-api wrangler command uses `--config beacon-api/wrangler.toml`.
- **Bottles never interact with flight:**
  - no collision;
  - no tractor-beam target;
  - no waypoint, badge, logbook goal or jump entry;
  - not in the live-sky protocol.
- Bottles draw in 1–2 instanced calls, with no per-frame allocation and no React re-renders in flight.
- Every PR adds a changelog entry, and the entries stay gap-free.
- Subagents never kill processes by name and never install packages.

## Tasks
1. **Filter module.** Add `src/utils/bottleFilter.ts` and `src/data/bottleFilter.ts` (the EN + ID word list). It exports `checkBottleText(raw): { ok: true, text } | { ok: false, reason }`, implementing spec rules 1–5. It is importable by both the client and the Worker.
   - Unit tests cover each rule: leetspeak, EN and ID samples, false-positive guards (for example "Scunthorpe"-style substrings must pass), and normalisation.
2. **Worker and data.**
   - Add `beacon-api/bottles.sql`: the migration plus a backfill of `text` from `BEACON_PHRASES`.
   - `GET /beacons` returns at most 30 rows with `hidden = 0`, shaped `{ id, x, y, z, text, at, country }`.
   - `POST /beacons` takes `{ x, y, z, text }`, or the legacy `{ phrase }`. It runs the filter, then the existing limits, then a new 5-per-day cap per ipHash, then inserts.
   - On rejection it returns `400 { error, reason }`.
   - Update `schema.sql` for fresh databases.
   - Tests: `tests/beaconApi.test.ts`, plus a local wrangler check that applies the migration to the local D1.
   - Document the `hidden` column and the deploy order in `beacon-api/README.md`.
3. **Client data and settings.**
   - Point `beaconApi`/`beaconActions` at the bottle shape: `BOTTLE_LIMIT` is 30, and the client merges in its own bottles.
   - Add a `showBottles` setting to the sky slice, persisted as `fitz-bottles` with default true, plus a logbook toggle next to live sky.
   - When `showBottles` is off, nothing is fetched or drawn.
   - Replace `BeaconPicker` with a `BottlePanel`: a text box, a 140-character counter, Send and Cancel, a friendly reason on rejection, and the text kept after an error.
   - The B key opens it, and the HUD button is relabelled "BOTTLE".
   - Keep the store-shape guard honest by updating its pinned keys.
   - Unit tests.
4. **The bottle model.**
   - Source a **CC0** glass bottle (Poly Haven, Kenney or similar), adapted with a rolled note and a cork. Record the source URL and licence in `assets-src/MANIFEST.md`.
   - It is small: ≤ 1,500 triangles and ≤ 150 KB. Put it in `public/models/`, through `optimize-assets.mjs`, because the game loads it.
   - Add an asset contract test.
   - Check it in the lab, or with a quick render: it must read as a bottle with a note at a glance.
   - If no CC0 model fits, build a simple lathe bottle in Blender and record why.
5. **Scene and reading.**
   - `Bottles.tsx` replaces `Beacons.tsx`: instanced, slow bob and turn, a faint glint, a distance fade, and none of the interactions listed under the global constraints.
   - The read card appears within about 8 u: text, country and age. Scanning (E) reads it. Both are suppressed when `showBottles` is off.
   - Reword the radio and scan lines.
   - Rework the e2e `beacons` probe into `bottles`, covering write, filter rejection, read, the toggle and the 30 cap.
   - Update README, add the changelog entry, and update perf budgets if the draw calls change.
