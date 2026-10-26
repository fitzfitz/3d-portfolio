# Messages in bottles (design)

**Date:** 2026-10-26.
**Status:** decisions from the owner in conversation; the controller's calls are marked.
**Replaces:** the fixed-phrase beacons (B key, BeaconPicker, `Beacons.tsx`, `beacon-api`).

## Why

Today a visitor's beacon is one of 9 fixed phrases, drawn as an object that people mistake for something they can use. The owner kept the feature but asked for two changes:
- free-text comments;
- a space object whose purpose is obvious and that disturbs nothing.

## Decisions (owner, 2026-10-26)

| Question | Decision |
|---|---|
| The object | **A message in a bottle** |
| Comments | **Free text, auto-published, passed through filters** |
| Show/hide | **A visitor setting** that shows or hides all bottles, for that visitor |
| How many | **At most 30 bottles appear** |

## Behaviour

### Writing a note
- B or the HUD button (renamed from BEACON to **BOTTLE (B)**) opens a small panel with:
  - a text box;
  - a live character counter, **max 140** characters (controller's call);
  - Send and Cancel.

  It replaces `BeaconPicker`. On touch, the existing HUD button opens the same panel.
- Send drops the bottle **where the ship is**, with the same position validation as beacons today (`validateDrop`).
- **Rate limits:** the existing limits stay as they are. That means one drop per pilot per 10 minutes (`RATE_WINDOW_MS`), `GLOBAL_PER_MINUTE` 10, and the Workers `LIMITER`. Controller's call: add a **daily cap of 5 per pilot**.
- **Errors are friendly and specific.** Examples:
  - "Links and contact details can't be posted."
  - "Please keep it friendly."
  - "One bottle every 10 minutes. Next in 6:12."
  - "Too short."

  The panel keeps the text so the visitor can edit it.

### Filters (controller's calls; run on the Worker and mirrored on the client for instant feedback)

The Worker is the authority. It applies the rules in order:
1. Normalise: NFKC, collapse whitespace, trim. Strip control and zero-width characters.
2. Length: 3–140 characters after normalising.
3. Reject links and contact details: URLs, `www.`, bare domains with a TLD, email addresses, `@handles`, and phone-number patterns (7 or more digits, allowing separators).
4. Reject profanity and slurs. Use a small curated English + Indonesian word list stored in the repo (`src/data/bottleFilter.ts`). Match whole words, case-insensitively, after mapping leetspeak (`0→o`, `1→i`, `3→e`, `4→a`, `5→s`, `$→s`, `@→a`).
5. Reject junk: the same character repeated 6 or more times, more than 50% non-letters, or all caps longer than 20 characters.

A rejection returns `400` with a `reason` code that the client maps to its friendly message. The client runs the same function before sending.

### Seeing and reading bottles
- **Model:** a small glass bottle with a rolled paper note inside and a cork, bobbing and turning slowly where it was left.
  - It has a faint glint so it can be spotted, and stays readable at a distance as a tiny highlight.
  - **No collision, no tractor-beam grab, no waypoint.** It is not in any badge, logbook goal or jump list.
- **Reading:** fly within about 8 u and a card unrolls on the HUD with the note text, the country flag or code, and "left 3 days ago". It closes when you fly away. Scanning (E) also reads it.
- **How many:** the newest **30** bottles show for everyone. A visitor always also sees **their own** bottles (`ownBeacons` today), even when they fall outside the 30.
- **Drawing:** one instanced draw call for all bottles; the glass can be a second call if needed. Bottles fade out with distance, like other small props.

### The visitor setting: Show bottles
- It is a toggle in the logbook panel, next to the live-sky toggle. **Default on.** It is saved in localStorage as `fitz-bottles`.
- **Off** means: no bottles drawn, no read cards, no scan reports of bottles. Writing still works: the B key and button stay available. If no bottles have loaded yet, nothing is fetched.

### The owner removing a bad note

Controller's call. The table gains a `hidden` column (0/1, default 0). The owner sets it to 1 in the D1 console to hide a note for everyone, the same way content is edited. The Worker only returns `hidden = 0` rows. `beacon-api/README.md` documents this.

### Data and API
- **Migration** (`beacon-api/bottles.sql`): `ALTER TABLE beacons ADD COLUMN text TEXT` and `ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`.
  - Backfill `text` for existing rows from their phrase, using `BEACON_PHRASES`.
  - Keep `phrase` for the old client. The new client ignores it.
  - Keep the table name: renaming tables in D1 is risky, and the name is internal.
- **API:**
  - `GET /beacons` returns at most 30 rows (`BOTTLE_LIMIT`), newest first, `hidden = 0`, each `{ id, x, y, z, text, at, country }`.
  - `POST /beacons` takes `{ x, y, z, text }`. It runs the filters, then the existing rate limits, then inserts. It still accepts the old `{ phrase }` body, mapping it to text, so a cached old client keeps working through the deploy.
  - `KEEP_ROWS` stays 500.
- **Deploy order:**
  1. Migrate.
  2. Deploy the Worker. It must work with the old site.
  3. Merge the site.

  Each needs the owner's word (CLAUDE.md).

### Safety
- Text is always rendered as **plain text**, never as HTML. Nothing in the card turns text into markup or links.
- The note is never sent to live-sky ghosts or anywhere else. Bottles are not part of the live-sky protocol.
- No personal data is collected beyond what beacons collect today (country code and hashed rate key).

## The model

Per the asset rule in `CLAUDE.md`, the model is **sourced, not generated**:
- a **CC0** glass bottle model (for example Poly Haven or Kenney), adapted if needed (a rolled note and a cork added);
- its source and licence recorded in `assets-src/MANIFEST.md`;
- optimised through `scripts/optimize-assets.mjs` into the game pack; it is small.

The builder may build a simple lathe bottle in Blender if no suitable CC0 model fits. Record why.

Check the model in the monster lab or a quick lab view. **Bar:** it reads as a bottle with a note at a glance, at normal viewing.

## Removed or changed
- **Removed:** `BeaconPicker` (fixed phrases) and `BEACON_PHRASES` as visitor choices. The phrases are kept only to backfill the migration and to map the legacy POST.
- **Renamed:** the old beacon visuals (`Beacons.tsx`) become `Bottles.tsx`, and the HUD label "BEACON" becomes "BOTTLE". The beacon radio and scan lines are reworded.
- **Changelog:** one visitor-facing entry.
- **Tests:** beacons tests move to bottles. New unit tests cover the filter rules (each rule, with leetspeak cases, plus Indonesian and English samples), the 30-cap with own bottles, and the visitor toggle. The e2e `beacons` probe becomes `bottles`.

## Out of scope
- Replies, likes or threads.
- Moderation UI beyond the D1 `hidden` column.
- Bottles in the combat stage: they stay non-interactive.
