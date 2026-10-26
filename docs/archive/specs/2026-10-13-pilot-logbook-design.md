# Pilot logbook

**Date:** 2026-10-13 · **Branch:** `feat/pilot-logbook` · **Status:** approved in brainstorming, awaiting spec review

## 1. Intent

The universe now has many separate activities: dossiers, the contact portal, shards, scanning, the ring course, world events, slingshots and mining. Nothing ties them together. The pilot logbook does, for two audiences at once:

- **Guide:** four *essentials* steer every visitor, including a recruiter in a hurry, through the portfolio: the three project dossiers and the contact portal.
- **Reward:** six *flight badges* reward the curious. Each one unlocks an engine-plume colour.

**Presence:** one HUD tracker line shows progress and the next goal; **L** (or a HUD button, or gamepad X) opens the full logbook panel.

**Success criteria**

1. A first-time visitor sees what to do next without opening anything.
2. Progress persists across visits, like shards and dossiers already do.
3. Earning a badge is a clear, announced moment, and its plume colour is visible on the ship.
4. No new WebGL shader programs, and no React renders per frame.
5. Desktop, gamepad, touch and screen readers all work.

**Out of scope:** hull paint schemes, a secret sector or other unlocks, sharing or leaderboards, badges for beacons or photo mode.

## 2. Entries

Ordered as shown; the tracker's "next goal" follows this order.

| # | id | Section | Title | Done when | Tracker hint (desktop / phone) | Plume |
|---|---|---|---|---|---|---|
| 1 | `ruangrapi` | essential | Read the RuangRapi dossier | `visitedDossiers` includes it | READ THE RUANGRAPI DOSSIER / RUANGRAPI DOSSIER | — |
| 2 | `portfolio` | essential | Read the Flight-Sim CV dossier | `visitedDossiers` includes it | READ THE FLIGHT-SIM CV DOSSIER / CV DOSSIER | — |
| 3 | `fuxx` | essential | Read the fuxx dossier | `visitedDossiers` includes it | READ THE FUXX DOSSIER / FUXX DOSSIER | — |
| 4 | `contact` | essential | Reach the contact portal | badge `contact` recorded on first portal dock | DOCK AT THE CONTACT PORTAL / CONTACT PORTAL | — |
| 5 | `slingshot` | badge | Slingshot | an assisted fast well exit (`SlingshotWatch` `whoosh`) | SKIM A PLANET FAST FOR A GRAVITY ASSIST / SLINGSHOT A PLANET | gold `#ffc23d` |
| 6 | `comet` | badge | Comet chaser | a completed scan of `comet_visitor` | SCAN A VISITING COMET (HOLD E) / SCAN A COMET | ice `#9fe8ff` |
| 7 | `ring` | badge | Ring runner | a ring-course lap under 60 s | LAP THE RING COURSE UNDER 1:00 / RING LAP < 1:00 | magenta `#ff3df0` |
| 8 | `ore` | badge | Prospector | mining fills a whole crystal's worth (16 ore) | MINE A CRYSTAL'S WORTH OF ORE (HOLD F) / MINE 16 ORE | amber `#ff8a1f` |
| 9 | `convoy` | badge | Convoy spotter | ship within 120u of a convoy ship during its orbit phase | WATCH A CONVOY DELIVER UP CLOSE / SPOT A CONVOY | lime `#a6ff3d` |
| 10 | `shards` | badge | Shard hunter | `shardsCollected.length ≥ 3` | FIND 3 DATA SHARDS / FIND 3 SHARDS | violet `#a77bff` |

The planet entry ids match the project ids in `src/data/projects.json` and the store's `visitedDossiers`; a test pins that.

## 3. Architecture

### 3.1 Pure model: `src/utils/logbook.ts`

- `LOGBOOK: readonly LogbookEntry[]`, where `LogbookEntry = { id, section: "essential" | "badge", title, hint, hintShort }`.
- `LogbookProgress = { visitedDossiers: readonly string[]; shardsCollected: readonly number[]; badges: readonly { id: string; at: string }[] }`.
- `entryDone(entry, progress): boolean`: dossier entries read `visitedDossiers`; `shards` reads `shardsCollected.length >= 3`; everything else checks `badges`.
- `logbookCount(progress): { done: number; total: number }`.
- `nextGoal(progress): LogbookEntry | null`: the first unfinished essential, then the first unfinished badge, then `null`.
- `essentialsDone(progress)` and `allDone(progress)` for the milestones.
- `convoySighted(ship, shipPositions, radius = 120): boolean` for the convoy hook.

### 3.2 Store (`src/store/spaceStore.ts`)

- `badges: { id: string; at: string }[]`, persisted as `fitz-logbook`. `at` is the local date `YYYY-MM-DD`. Loaded with a guard that keeps only known badge ids, drops malformed rows and de-duplicates.
- `recordBadge(id)`:
  - a no-op if already earned or unknown;
  - otherwise appends `{ id, at }`, persists, plays `soundManager.badge()` (a short new chime), and sends an **announced** (not silent) broadcast built from the entry, e.g. `LOGBOOK // SLINGSHOT EARNED — GOLD PLUME UNLOCKED. PRESS L`. The `contact` essential uses `LOGBOOK // CONTACT PORTAL REACHED`.
  - Never called per frame: every hook below is a discrete event or a gate.
- `setOrbitLocked(true)` with `activeZone === "contact"` calls `recordBadge("contact")`.
- `plumeColor: string` (a badge id or `"stock"`), persisted as `fitz-plume`. A value is valid when it is `"stock"`, or a badge entry with a plume for which `entryDone` is true (this includes the derived Shard hunter). On load an invalid value falls back to `"stock"`, and `setPlumeColor(id)` ignores one.
- `logbookOpen: boolean` (not persisted) and `setLogbookOpen(v)`.

### 3.3 Badge hooks (one call each, at existing detection points)

| Badge | Where | Call |
|---|---|---|
| `slingshot` | `Spaceship.tsx`, where `SlingshotWatch` returns `whoosh: true` | `recordBadge("slingshot")` |
| `comet` | `Scanner.tsx`, when a scan completes for `comet_visitor` | `recordBadge("comet")` |
| `ring` | `RingCourse.tsx`, on the transition to `finished` with lap time < 60 | `recordBadge("ring")` |
| `ore` | `AsteroidBelt.tsx`, when `addOre` reports `crystals > 0` | `recordBadge("ore")` |
| `convoy` | `WorldEventDirector.tsx`, every 0.5 s while a convoy is in its orbit phase, using `convoySighted` | `recordBadge("convoy")` |
| `shards` | derived; no hook | — |

`addOre` gains a `crystals` field: how many whole crystals' worth this call completed (the rollover count).

### 3.4 Milestones

A store subscription (in `LogbookTracker`), guarded by module-level flags like the shard fanfare, fires each milestone once per page load, and only on a transition during this visit:

- All essentials just completed: announced line `TOUR COMPLETE // THE PILOT'S RÉSUMÉ AND CONTACT ARE ONE CLICK AWAY`.
- Everything just completed: `soundManager.fanfare()` and the announced line `LOGBOOK COMPLETE // ALL PLUMES UNLOCKED. FLY PRETTY, PILOT`.

A returning visitor whose stored progress is already complete gets no announcements on load.

## 4. UI

### 4.1 Tracker (`src/components/layout/LogbookTracker.tsx`, mounted in `HUDOverlay` under `SHARDS`)

- Desktop: `LOGBOOK n/10  > NEXT: <hint>`. Phone (below `sm`): `LOG n/10 > <hintShort>`.
- Complete: `LOGBOOK 10/10 // COMPLETE` in the accent colour.
- A `<button>` that opens the panel. It re-renders only when progress changes (store selectors on `badges`, `visitedDossiers`, `shardsCollected`).
- On a new badge it pulses for 1.5 s (a CSS class), skipped under reduced motion.

### 4.2 Opening the panel

- **L** in `App.tsx`'s existing key handler (like P and B): toggles `logbookOpen`; ignored in editable fields, with chords, on the classic résumé, and while the beacon picker is open.
- A **LOGBOOK** button in the bottom-left HUD button row (icon `BookOpen`, label hidden on phones).
- Gamepad **X** (button index 2) via `padActions`, as a new `{ kind: "logbook" }` action.
- The panel closes automatically when a dossier opens (orbit lock), when photo mode starts, and when the classic résumé opens.

### 4.3 Panel (`src/components/layout/LogbookPanel.tsx`)

- Desktop: a right-side sheet (max width ~380 px); phones: a bottom sheet (max height 70 vh, scrollable). Styled like the dossier cards (`glass-card`, mono labels).
- **Flight keeps running**: `role="dialog"`, `aria-modal="false"`, `aria-labelledby` the heading. Flight keys still fly.
- Contents:
  - header `PILOT LOGBOOK  n / 10`;
  - **Essentials** list;
  - **Flight badges** list: each shows its swatch; earned entries show a check and `EARNED <date>`; locked ones show a lock and the hint;
  - the **plume picker** (§5).
- Each entry's accessible text reads, e.g., "Slingshot, earned 2026-10-13" or "Comet chaser, not yet: scan a visiting comet".
- Focus moves to the heading on open and returns to the opener on close. **Esc** or **L** closes it. All controls are reachable by Tab.

## 5. Plume colours

- `src/data/plumeColors.ts`: `PLUME_COLORS: Record<"stock" | badge id, { name: string; hex: string }>`. Stock cyan matches the current plume (`#00d9ff` cool end).
- Applying a colour (once per change, via a store subscription in `Spaceship.tsx`, never per frame) tints the whole exhaust:
  - the three plume materials' `uColor`;
  - the spark vertex-colour base (currently `0.55, 1.0, 1.0` × brightness), derived from the colour;
  - the engine point light's `color`;
  - the engine material's `emissive` colour (the nozzle spots).
- Warp streaks and the tractor beam keep their own colours.
- All of these are uniform or CPU colour changes, so no new shader programs.
- **Picker:** a radio group of swatches in the panel. Locked swatches are disabled and labelled "Earn <badge> to unlock". Selecting one applies it immediately (the ship is visible behind the side sheet). The choice persists.

## 6. Testing

### 6.1 Unit (Vitest)

| File | Covers |
|---|---|
| `tests/logbook.test.ts` | each `entryDone` rule; counts; `nextGoal` order (essentials, then badges, then null); `essentialsDone`/`allDone`; planet entry ids match `projects.json`; `convoySighted` at the 120u edge |
| `tests/spaceStore.test.ts` | `recordBadge`: guarded, persists `fitz-logbook` with the date, announced broadcast; load filters unknown/malformed/duplicate rows; first portal dock records `contact`; `plumeColor` locked/unknown falls back to `stock` on load and in `setPlumeColor` |
| `tests/mining.test.ts` | `addOre` reports the `crystals` rollover count |
| `tests/plumeColors.test.ts` | every badge with a plume has a valid, unique hex; `stock` exists |
| `tests/gamepad.test.ts` | button X press edge yields `{ kind: "logbook" }` |

### 6.2 End-to-end: `tests/e2e/logbook.probe.mjs` (registered in `run.mjs`)

1. Fresh load: tracker shows `0/10` and the first essential's hint.
2. Jump to a planet (number key): its dossier entry is done and the tracker advances.
3. Dev hooks (`fitzDebug.recordBadge`): recording `slingshot` and `comet` raises the count and announces the line in the aria-live region.
4. L opens the panel and focus lands on its heading; Esc closes it and focus returns. The HUD button and gamepad X (by dispatching the action) also open it.
5. Picking the gold plume changes the plume materials' `uColor`, and the shader-program count is unchanged.
6. Reload: progress and plume persist. A tampered `fitz-plume` value falls back to stock.
7. Phone emulation: the tracker and the LOGBOOK button are visible; the panel opens as a bottom sheet and does not cover the touch flight buttons.

### 6.3 Real-browser pass (Playwright MCP) before the PR

Earn slingshot, comet and ore naturally in flight; screenshot the tracker, the panel, and the ship with each plume colour on desktop and phone; check readability and bloom.

### 6.4 Verification bar

All unit tests, `tsc -b`, lint unchanged, the full e2e suite, a fresh whole-branch review, then the PR. Merge after checks; it deploys.

## 7. Risks

| Risk | Mitigation |
|---|---|
| A plume colour washes out under bloom | Colours tuned in the real-browser pass; constants live in one data file |
| The panel covers HUD or touch controls on phones | e2e geometry check (§6.2 item 7) and a phone screenshot |
| A hook fires per frame and spams `recordBadge` | `recordBadge` is change-guarded and a unit test pins it; hooks sit on discrete events |
| Gamepad X conflicts with a future binding | Documented in the gamepad mapping comment and the controller-linked line |

## 8. Changelog (patch notes)

Added 2026-10-13, approved in chat; ships in the same branch and PR as the logbook.

### 8.1 Intent

Visitors and recruiters can see what shipped, and why. The changelog starts with **October 2026**: PRs #1–#17, plus the logbook as #18. Each item answers **what / why / when / how**.

### 8.2 Content: `src/data/changelog.ts`

- `ChangelogEntry = { id: string; date: "YYYY-MM-DD"; pr: number; title: string; what: string; why: string; how: string }`; `CHANGELOG: readonly ChangelogEntry[]`, newest first.
- **When** is the `date` plus the PR number, which links to `https://github.com/fitzfitz/3d-portfolio/pull/<pr>`.
- Written for visitors, not developers: plain language, no file or function names. Length caps: `what` and `why` ≤ 220 characters, `how` ≤ 240, `title` 1–4 words.
- Each future feature PR adds its own entry in the same PR.

### 8.3 In-game panel: `src/components/layout/ChangelogPanel.tsx`

- Opened by a **PATCH NOTES** button in the HUD button row (next to LOGBOOK) and the **N** key. N follows the same rules as L: ignored in editable fields, with chords, on the résumé, in photo mode, while docked, and while the beacon picker is open.
- A non-modal sheet styled like the logbook. Opening either sheet closes the other.
- Each entry shows its title, then labelled lines: **WHAT**, **WHY**, **WHEN** (`2026-10-13 · PR #17`, the PR part a link) and **HOW**.
- Same accessibility as the logbook: `role="dialog"`, `aria-modal="false"`, focus to the heading on open and back on close, Esc closes, Tab reaches everything.
- **NEW dot:** stored as `fitz-changelog-seen`, the newest entry id the visitor has seen.
  - On a **first visit** (no stored value) it is set silently to the newest id, so first-timers get no dot.
  - A **returning** visitor whose stored id differs from the newest sees a dot on the button.
  - Opening the panel stores the newest id and clears the dot.

### 8.4 Résumé section: `src/components/sections/Changelog.tsx`

- The classic résumé gets a **Changelog** section (`id="changelog"`) between Skills and Contact, following the Career section's layout. It shows the same entries newest first, each with the WHAT / WHY / WHEN / HOW labels.
- A **Changelog** link is added to the résumé navbar.

### 8.5 Store

`changelogOpen` and `setChangelogOpen(v)`. Opening it sets `logbookOpen` false, and opening the logbook sets `changelogOpen` false. `changelogSeen: string` and `markChangelogSeen()`.

### 8.6 Testing

- **Unit (`tests/changelog.test.ts`):**
  - every entry has valid ISO dates, newest first, unique ids, a positive PR number, and all fields non-empty and within their caps;
  - every PR from 1 to the newest appears at most once;
  - the seen rule `hasUnseen(newestId, seen)`.
- **Store:** `changelogOpen` and `logbookOpen` are mutually exclusive; the first visit stores the newest id; `markChangelogSeen` stores it.
- **e2e (in the logbook probe):**
  - the PATCH NOTES button and N open the panel, with focus on the heading;
  - a returning visitor with an older seen id gets the dot, and opening the panel clears it;
  - opening the logbook closes the changelog;
  - the résumé renders a Changelog section with every entry;
  - on a phone, the open panel does not cover the flight buttons.
