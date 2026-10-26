# Pilot Logbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pilot logbook: four essentials that guide every visitor through the portfolio, six flight badges that each unlock an engine-plume colour, a HUD tracker line, and an L panel.

**Architecture:** A pure model (`src/utils/logbook.ts`) derives progress from state the store already persists (dossiers, shards) plus a new persisted `badges` list. Existing systems record badges with one `recordBadge(id)` call at the moment they already detect the event. The UI is DOM-only (`LogbookTracker`, `LogbookPanel`). Plume colours are uniform and CPU colour changes on the existing exhaust.

**Tech Stack:** React 19, React Three Fiber, three.js, zustand, Vitest (`npm test`), Puppeteer e2e probes (`npm run test:e2e`), TypeScript (`tsc -b`), oxlint (`npm run lint`).

**Spec:** `docs/archive/specs/2026-10-13-pilot-logbook-design.md`. Read it first; §2 is the entry table.

## Global Constraints

- No new WebGL shader programs. Plume colours change existing uniforms and colours only; the e2e probe asserts the program count is unchanged.
- No React renders per frame. The store updates only on discrete events; `recordBadge` is change-guarded.
- `src/store/spaceStore.ts` must not import `src/audio/soundManager.ts` (soundManager imports the store). Sounds for store events go through subscriptions in `src/hooks/useSound.ts`.
- Storage keys: `fitz-logbook` is a JSON array of `{ id: string; at: "YYYY-MM-DD" }`; `fitz-plume` is a JSON string (`"stock"` or a badge id). All reads and writes go through the store's existing `safeGetJSON`/`safeSetJSON`.
- Badge broadcasts are announced (not silent). Copy is uppercase in the house voice.
- Returning visitors get no catch-up announcements for progress they already had.
- Subagents must not run any package install (`npm install`, `npm ci`, `pnpm`) and must not `kill`/`pkill` processes by name.
- When proving a regression test catches the old bug, revert only the source file, never the test.
- Commit after every task with the message given, ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Close any browser tab rendering the app before `npm run test:e2e`.

## Review Focus

1. **Returning visitor with stored progress.** A reload must show existing progress and the chosen plume immediately, with no milestone or badge announcements. Tests: Task 6 "fires no milestone for progress that was already there"; Task 8 "a reload announces nothing for old progress".
2. **A hook firing repeatedly** (the convoy check every 0.5 s, every slingshot exit). Only the first call may record, chime or announce. Test: Task 3 "recordBadge is a no-op once earned".
3. **Tampered or stale storage** (malformed `fitz-logbook`, a `fitz-plume` for a locked badge). It must load cleanly and fall back to stock. Tests: Task 3 `loadBadges`; Task 8 tamper check.
4. **L pressed while a dossier is open.** It must not toggle the panel. Test: Task 8 "L does nothing while a dossier is open".
5. **The panel on a phone** covering the touch flight buttons. Test: Task 8 phone geometry check.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/utils/logbook.ts` | create | entries, done rules, counts, next goal, milestones, badge line, convoy sighting, plume validity |
| `src/data/plumeColors.ts` | create | plume colour table, spark base colour |
| `src/store/spaceStore.ts` | modify | `badges`, `recordBadge`, `contact` on portal dock, `plumeColor`, `logbookOpen` |
| `src/hooks/useSound.ts` | modify | badge chime on a new badge |
| `src/audio/soundManager.ts` | modify | `badge()` cue |
| `src/utils/mining.ts` | modify | `addOre` reports `crystals` |
| `src/components/canvas/Spaceship.tsx` | modify | slingshot hook; apply plume colour |
| `src/components/canvas/Scanner.tsx` | modify | comet hook |
| `src/components/canvas/RingCourse.tsx` | modify | ring hook |
| `src/components/canvas/AsteroidBelt.tsx` | modify | ore hook |
| `src/components/canvas/WorldEventDirector.tsx` | modify | convoy hook |
| `src/components/layout/LogbookTracker.tsx` | create | HUD line and milestones |
| `src/components/layout/LogbookPanel.tsx` | create | panel and plume picker |
| `src/components/layout/HUDOverlay.tsx` | modify | mount the tracker; LOGBOOK button; controls hint |
| `src/App.tsx` | modify | L key; mount the panel |
| `src/utils/gamepad.ts`, `src/hooks/useGamepadInput.ts` | modify | X → logbook action |
| `tests/e2e/logbook.probe.mjs`, `tests/e2e/run.mjs` | create / modify | e2e |

---

### Task 1: The logbook model

**Files:**
- Create: `src/utils/logbook.ts`
- Test: `tests/logbook.test.ts`

**Interfaces:**
- Produces:
  - `type LogbookSection = "essential" | "badge"`
  - `interface LogbookEntry { id: string; section: LogbookSection; title: string; hint: string; hintShort: string; plume: boolean }`
  - `interface BadgeRecord { id: string; at: string }`
  - `interface LogbookProgress { visitedDossiers: readonly string[]; shardsCollected: readonly number[]; badges: readonly BadgeRecord[] }`
  - `LOGBOOK: readonly LogbookEntry[]`, `SHARDS_FOR_BADGE = 3`, `CONVOY_SIGHT_RADIUS = 120`
  - `entryDone(e, p): boolean`, `logbookCount(p): { done: number; total: number }`, `nextGoal(p): LogbookEntry | null`
  - `essentialsDone(p): boolean`, `allDone(p): boolean`
  - `isRecordable(id: string): boolean` (the ids `recordBadge` accepts: every entry except the derived dossier and shard entries)
  - `badgeLine(id: string, plumeName: string | null): string`
  - `convoySighted(ship: Vec3, ships: readonly Vec3[], radius?: number): boolean`
  - `plumeAllowed(id: string, p: LogbookProgress, hasColour: (id: string) => boolean): boolean`

- [ ] **Step 1: Write the failing tests**

Create `tests/logbook.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  LOGBOOK, entryDone, logbookCount, nextGoal, essentialsDone, allDone, isRecordable,
  badgeLine, convoySighted, plumeAllowed, type LogbookProgress,
} from "../src/utils/logbook";
import projects from "../src/data/projects.json";

const empty: LogbookProgress = { visitedDossiers: [], shardsCollected: [], badges: [] };
const withBadges = (...ids: string[]): LogbookProgress => ({ ...empty, badges: ids.map((id) => ({ id, at: "2026-10-13" })) });
const byId = (id: string) => LOGBOOK.find((e) => e.id === id)!;

describe("LOGBOOK", () => {
  it("has 4 essentials then 6 badges, ids unique", () => {
    expect(LOGBOOK.map((e) => e.section)).toEqual([...Array(4).fill("essential"), ...Array(6).fill("badge")]);
    expect(new Set(LOGBOOK.map((e) => e.id)).size).toBe(LOGBOOK.length);
  });
  it("has a dossier essential for every project, by its id", () => {
    for (const p of projects) expect(byId(p.id)?.section).toBe("essential");
  });
  it("gives every badge a plume and no essential one", () => {
    for (const e of LOGBOOK) expect(e.plume).toBe(e.section === "badge");
  });
});

describe("entryDone", () => {
  it("reads dossiers from visitedDossiers", () => {
    expect(entryDone(byId("fuxx"), empty)).toBe(false);
    expect(entryDone(byId("fuxx"), { ...empty, visitedDossiers: ["fuxx"] })).toBe(true);
  });
  it("needs 3 shards for the shard badge", () => {
    expect(entryDone(byId("shards"), { ...empty, shardsCollected: [0, 4] })).toBe(false);
    expect(entryDone(byId("shards"), { ...empty, shardsCollected: [0, 4, 9] })).toBe(true);
  });
  it("reads every other entry from the recorded badges", () => {
    expect(entryDone(byId("contact"), withBadges("contact"))).toBe(true);
    expect(entryDone(byId("slingshot"), withBadges("comet"))).toBe(false);
  });
});

describe("progress", () => {
  it("counts done entries", () => {
    expect(logbookCount(empty)).toEqual({ done: 0, total: 10 });
    expect(logbookCount({ ...withBadges("slingshot"), visitedDossiers: ["fuxx"] })).toEqual({ done: 2, total: 10 });
  });
  it("points at the first unfinished essential, then badges, then nothing", () => {
    expect(nextGoal(empty)?.id).toBe(LOGBOOK[0].id);
    const essentials: LogbookProgress = { ...withBadges("contact"), visitedDossiers: projects.map((p) => p.id) };
    expect(essentialsDone(essentials)).toBe(true);
    expect(nextGoal(essentials)?.id).toBe("slingshot");
    const everything: LogbookProgress = {
      ...withBadges("contact", "slingshot", "comet", "ring", "ore", "convoy"),
      visitedDossiers: projects.map((p) => p.id), shardsCollected: [1, 2, 3],
    };
    expect(allDone(everything)).toBe(true);
    expect(nextGoal(everything)).toBeNull();
  });
});

describe("isRecordable", () => {
  it("accepts recorded entries only", () => {
    for (const id of ["contact", "slingshot", "comet", "ring", "ore", "convoy"]) expect(isRecordable(id)).toBe(true);
    for (const id of ["fuxx", "shards", "nope"]) expect(isRecordable(id)).toBe(false);
  });
});

describe("badgeLine", () => {
  it("names the badge and its plume", () => {
    expect(badgeLine("slingshot", "GOLD")).toBe("LOGBOOK // SLINGSHOT EARNED — GOLD PLUME UNLOCKED. PRESS L");
  });
  it("uses the portal line for the contact essential", () => {
    expect(badgeLine("contact", null)).toBe("LOGBOOK // CONTACT PORTAL REACHED");
  });
});

describe("convoySighted", () => {
  const ship = { x: 0, y: 0, z: 0 };
  it("is true inside the radius and false outside", () => {
    expect(convoySighted(ship, [{ x: 500, y: 0, z: 0 }, { x: 119, y: 0, z: 0 }])).toBe(true);
    expect(convoySighted(ship, [{ x: 121, y: 0, z: 0 }])).toBe(false);
  });
  it("works across the wrap seam", () => {
    expect(convoySighted({ x: 240, y: 0, z: 0 }, [{ x: -240, y: 0, z: 0 }])).toBe(true);
  });
});

describe("plumeAllowed", () => {
  const hasColour = (id: string) => id === "stock" || id === "slingshot" || id === "shards";
  it("always allows stock", () => {
    expect(plumeAllowed("stock", empty, hasColour)).toBe(true);
  });
  it("allows a colour only once its badge is done, including derived ones", () => {
    expect(plumeAllowed("slingshot", empty, hasColour)).toBe(false);
    expect(plumeAllowed("slingshot", withBadges("slingshot"), hasColour)).toBe(true);
    expect(plumeAllowed("shards", { ...empty, shardsCollected: [1, 2, 3] }, hasColour)).toBe(true);
  });
  it("rejects unknown ids and essentials", () => {
    expect(plumeAllowed("contact", withBadges("contact"), () => true)).toBe(false);
    expect(plumeAllowed("nope", empty, () => true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/logbook.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/utils/logbook.ts`**

```ts
import { COSMIC_BOUNDS } from "../constants";
import { toroidalDistance3 } from "./toroidal";
import type { Vec3 } from "./reactions";

/**
 * The pilot logbook (docs/archive/specs/2026-10-13-pilot-logbook-design.md):
 * four essentials that tour the portfolio, then six flight badges that each
 * unlock a plume colour. Pure. Dossier and shard entries are derived from
 * state the store already persists; the rest are recorded badges.
 */
export type LogbookSection = "essential" | "badge";
export interface LogbookEntry { id: string; section: LogbookSection; title: string; hint: string; hintShort: string; plume: boolean }
export interface BadgeRecord { id: string; at: string }
export interface LogbookProgress {
  visitedDossiers: readonly string[];
  shardsCollected: readonly number[];
  badges: readonly BadgeRecord[];
}

export const SHARDS_FOR_BADGE = 3;
export const CONVOY_SIGHT_RADIUS = 120;

/** Entry ids derived from other state, never recorded. */
const DOSSIERS: readonly string[] = ["ruangrapi", "portfolio", "fuxx"];

export const LOGBOOK: readonly LogbookEntry[] = [
  { id: "ruangrapi", section: "essential", title: "Read the RuangRapi dossier", hint: "READ THE RUANGRAPI DOSSIER", hintShort: "RUANGRAPI DOSSIER", plume: false },
  { id: "portfolio", section: "essential", title: "Read the Flight-Sim CV dossier", hint: "READ THE FLIGHT-SIM CV DOSSIER", hintShort: "CV DOSSIER", plume: false },
  { id: "fuxx", section: "essential", title: "Read the fuxx dossier", hint: "READ THE FUXX DOSSIER", hintShort: "FUXX DOSSIER", plume: false },
  { id: "contact", section: "essential", title: "Reach the contact portal", hint: "DOCK AT THE CONTACT PORTAL", hintShort: "CONTACT PORTAL", plume: false },
  { id: "slingshot", section: "badge", title: "Slingshot", hint: "SKIM A PLANET FAST FOR A GRAVITY ASSIST", hintShort: "SLINGSHOT A PLANET", plume: true },
  { id: "comet", section: "badge", title: "Comet chaser", hint: "SCAN A VISITING COMET (HOLD E)", hintShort: "SCAN A COMET", plume: true },
  { id: "ring", section: "badge", title: "Ring runner", hint: "LAP THE RING COURSE UNDER 1:00", hintShort: "RING LAP < 1:00", plume: true },
  { id: "ore", section: "badge", title: "Prospector", hint: "MINE A CRYSTAL'S WORTH OF ORE (HOLD F)", hintShort: "MINE 16 ORE", plume: true },
  { id: "convoy", section: "badge", title: "Convoy spotter", hint: "WATCH A CONVOY DELIVER UP CLOSE", hintShort: "SPOT A CONVOY", plume: true },
  { id: "shards", section: "badge", title: "Shard hunter", hint: `FIND ${SHARDS_FOR_BADGE} DATA SHARDS`, hintShort: `FIND ${SHARDS_FOR_BADGE} SHARDS`, plume: true },
];

export function entryDone(e: LogbookEntry, p: LogbookProgress): boolean {
  if (DOSSIERS.includes(e.id)) return p.visitedDossiers.includes(e.id);
  if (e.id === "shards") return p.shardsCollected.length >= SHARDS_FOR_BADGE;
  return p.badges.some((b) => b.id === e.id);
}

export function logbookCount(p: LogbookProgress): { done: number; total: number } {
  let done = 0;
  for (const e of LOGBOOK) if (entryDone(e, p)) done++;
  return { done, total: LOGBOOK.length };
}

/** First unfinished entry in table order (essentials come first), or null. */
export function nextGoal(p: LogbookProgress): LogbookEntry | null {
  return LOGBOOK.find((e) => !entryDone(e, p)) ?? null;
}

export function essentialsDone(p: LogbookProgress): boolean {
  return LOGBOOK.every((e) => e.section !== "essential" || entryDone(e, p));
}

export function allDone(p: LogbookProgress): boolean {
  return LOGBOOK.every((e) => entryDone(e, p));
}

/** The ids recordBadge accepts: every entry not derived from other state. */
export function isRecordable(id: string): boolean {
  return LOGBOOK.some((e) => e.id === id) && !DOSSIERS.includes(id) && id !== "shards";
}

/** The announced radio line for a newly earned entry. */
export function badgeLine(id: string, plumeName: string | null): string {
  if (id === "contact") return "LOGBOOK // CONTACT PORTAL REACHED";
  const e = LOGBOOK.find((x) => x.id === id);
  const title = (e?.title ?? id).toUpperCase();
  return plumeName
    ? `LOGBOOK // ${title} EARNED — ${plumeName} PLUME UNLOCKED. PRESS L`
    : `LOGBOOK // ${title} EARNED. PRESS L`;
}

/** True when any convoy ship is within `radius` of the ship (wrap-aware). */
export function convoySighted(ship: Vec3, ships: readonly Vec3[], radius = CONVOY_SIGHT_RADIUS): boolean {
  for (const s of ships) {
    if (toroidalDistance3(ship.x, ship.z, ship.y, s.x, s.z, s.y, COSMIC_BOUNDS) < radius) return true;
  }
  return false;
}

/**
 * Whether plume `id` may be selected: "stock" always; otherwise a badge entry
 * with a colour whose entry is done (derived badges count too).
 */
export function plumeAllowed(id: string, p: LogbookProgress, hasColour: (id: string) => boolean): boolean {
  if (id === "stock") return true;
  const e = LOGBOOK.find((x) => x.id === id);
  return !!e && e.section === "badge" && e.plume && hasColour(id) && entryDone(e, p);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/logbook.test.ts && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/logbook.ts tests/logbook.test.ts
git commit -m "feat(logbook): pure model — entries, progress, next goal, badge lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Plume colour table

**Files:**
- Create: `src/data/plumeColors.ts`
- Test: `tests/plumeColors.test.ts`

**Interfaces:**
- Consumes: `LOGBOOK` (Task 1).
- Produces: `PLUME_COLORS: Readonly<Record<string, { name: string; hex: string }>>` (keys `"stock"` and every badge id); `hasPlumeColour(id: string): boolean`; `sparkBase(hex: string, out: [number, number, number]): [number, number, number]` (the colour scaled so its brightest channel is 1).

- [ ] **Step 1: Write the failing tests**

Create `tests/plumeColors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PLUME_COLORS, hasPlumeColour, sparkBase } from "../src/data/plumeColors";
import { LOGBOOK } from "../src/utils/logbook";

describe("PLUME_COLORS", () => {
  it("has stock and a colour for every badge, with valid unique hexes", () => {
    expect(PLUME_COLORS.stock.hex).toBe("#00d9ff");
    const badges = LOGBOOK.filter((e) => e.section === "badge").map((e) => e.id);
    for (const id of badges) expect(hasPlumeColour(id), id).toBe(true);
    const hexes = Object.values(PLUME_COLORS).map((c) => c.hex);
    for (const h of hexes) expect(h).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(hexes).size).toBe(hexes.length);
  });
  it("knows nothing about essentials or unknown ids", () => {
    expect(hasPlumeColour("contact")).toBe(false);
    expect(hasPlumeColour("nope")).toBe(false);
  });
});

describe("sparkBase", () => {
  it("normalises so the brightest channel is 1", () => {
    expect(sparkBase("#ff8000", [0, 0, 0])).toEqual([1, 128 / 255, 0]);
    const [r, g, b] = sparkBase("#00d9ff", [0, 0, 0]);
    expect(Math.max(r, g, b)).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/plumeColors.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/data/plumeColors.ts`**

```ts
/**
 * Engine-plume colours unlocked by logbook badges (spec §5). `stock` is the
 * engine's cyan: the plume shader's original vec3(0, 0.85, 1). Applied as
 * uniform/CPU colour changes only (Spaceship.tsx), so no shader programs are
 * added. Tuned against bloom in the real-browser pass.
 */
export const PLUME_COLORS: Readonly<Record<string, { name: string; hex: string }>> = {
  stock: { name: "CYAN", hex: "#00d9ff" },
  slingshot: { name: "GOLD", hex: "#ffc23d" },
  comet: { name: "ICE", hex: "#9fe8ff" },
  ring: { name: "MAGENTA", hex: "#ff3df0" },
  ore: { name: "AMBER", hex: "#ff8a1f" },
  convoy: { name: "LIME", hex: "#a6ff3d" },
  shards: { name: "VIOLET", hex: "#a77bff" },
};

export function hasPlumeColour(id: string): boolean {
  return Object.hasOwn(PLUME_COLORS, id);
}

/** The spark vertex-colour base for a plume: the colour scaled so its brightest channel is 1. */
export function sparkBase(hex: string, out: [number, number, number]): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const m = Math.max(r, g, b) || 1;
  out[0] = r / m; out[1] = g / m; out[2] = b / m;
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/plumeColors.test.ts tests/logbook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/plumeColors.ts tests/plumeColors.test.ts
git commit -m "feat(logbook): plume colour table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Store — badges, plume colour, panel state; badge chime

**Files:**
- Modify: `src/store/spaceStore.ts`
- Modify: `src/hooks/useSound.ts`, `src/audio/soundManager.ts`
- Test: `tests/spaceStore.test.ts`

**Interfaces:**
- Consumes: `isRecordable`, `badgeLine`, `plumeAllowed`, `LOGBOOK`, `type BadgeRecord` (Task 1); `PLUME_COLORS`, `hasPlumeColour` (Task 2).
- Produces: store `badges: BadgeRecord[]`, `recordBadge(id: string): void`, `plumeColor: string`, `setPlumeColor(id: string): void`, `logbookOpen: boolean`, `setLogbookOpen(v: boolean): void`. Exported pure helpers `loadBadges(raw: unknown): BadgeRecord[]` and `todayStamp(d?: Date): string`. e2e reaches `recordBadge` through `window.__fitz.store`; no extra debug hook is needed.

- [ ] **Step 1: Write the failing tests**

In `tests/spaceStore.test.ts`, add `badges: [], plumeColor: "stock", logbookOpen: false,` to the `beforeEach` `setState` literal, add `loadBadges, todayStamp` to the import from `../src/store/spaceStore`, and append inside `describe("spaceStore", ...)`:

```ts
  it("recordBadge records once, persists with the date and announces", () => {
    const s = useSpaceStore.getState();
    s.recordBadge("slingshot");
    const st = useSpaceStore.getState();
    expect(st.badges.map((b) => b.id)).toEqual(["slingshot"]);
    expect(st.badges[0].at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(st.broadcast).toMatchObject({ text: "LOGBOOK // SLINGSHOT EARNED — GOLD PLUME UNLOCKED. PRESS L", silent: false });
  });

  it("recordBadge is a no-op once earned, and for derived or unknown ids", () => {
    const s = useSpaceStore.getState();
    s.recordBadge("comet");
    const id = useSpaceStore.getState().broadcast?.id;
    s.recordBadge("comet");
    s.recordBadge("fuxx");
    s.recordBadge("shards");
    s.recordBadge("nope");
    expect(useSpaceStore.getState().badges).toHaveLength(1);
    expect(useSpaceStore.getState().broadcast?.id).toBe(id);
  });

  it("records the contact essential on the first dock at the portal", () => {
    useSpaceStore.setState({ activeZone: "contact" });
    useSpaceStore.getState().setOrbitLocked(true);
    expect(useSpaceStore.getState().badges.map((b) => b.id)).toEqual(["contact"]);
  });

  it("loadBadges keeps known recordable ids, drops malformed rows and duplicates", () => {
    expect(loadBadges([{ id: "comet", at: "2026-10-13" }, { id: "comet", at: "2026-10-14" }, { id: "fuxx", at: "x" },
      { id: "nope", at: "2026-10-13" }, "junk", null, { id: "ring" }])).toEqual([{ id: "comet", at: "2026-10-13" }]);
    expect(loadBadges("not an array")).toEqual([]);
  });

  it("setPlumeColor only accepts unlocked colours", () => {
    const s = useSpaceStore.getState();
    s.setPlumeColor("slingshot");
    expect(useSpaceStore.getState().plumeColor).toBe("stock");
    s.recordBadge("slingshot");
    s.setPlumeColor("slingshot");
    expect(useSpaceStore.getState().plumeColor).toBe("slingshot");
    s.setPlumeColor("nope");
    expect(useSpaceStore.getState().plumeColor).toBe("slingshot");
  });

  it("todayStamp formats the local date", () => {
    expect(todayStamp(new Date(2026, 9, 3))).toBe("2026-10-03");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/spaceStore.test.ts`
Expected: FAIL (missing members).

- [ ] **Step 3: Implement the store changes**

In `src/store/spaceStore.ts`:

1. Imports:

```ts
import { isRecordable, badgeLine, plumeAllowed, LOGBOOK, type BadgeRecord } from "../utils/logbook";
import { PLUME_COLORS, hasPlumeColour } from "../data/plumeColors";
```

2. Exported pure helpers, next to `loadVisitedDossiers`:

```ts
/** Local date as YYYY-MM-DD, for the "earned" stamp. */
export function todayStamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Stored badges, sanitised: known recordable ids only, a string date, first
 * occurrence wins. Hand-edited or stale storage must not crash the store or
 * grant anything.
 */
export function loadBadges(raw: unknown): BadgeRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: BadgeRecord[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { id, at } = r as { id?: unknown; at?: unknown };
    if (typeof id !== "string" || typeof at !== "string" || !isRecordable(id)) continue;
    if (out.some((b) => b.id === id)) continue;
    out.push({ id, at });
  }
  return out;
}
```

3. `SpaceState` additions:

```ts
  /** Logbook badges earned (persisted as fitz-logbook). Dossiers and shards are derived elsewhere. */
  badges: BadgeRecord[];
  recordBadge: (id: string) => void;
  /** Selected plume colour: "stock" or an unlocked badge id (persisted as fitz-plume). */
  plumeColor: string;
  setPlumeColor: (id: string) => void;
  logbookOpen: boolean;
  setLogbookOpen: (v: boolean) => void;
```

4. Initial values. Before `export const useSpaceStore`:

```ts
const initialBadges = loadBadges(safeGetJSON<unknown>("fitz-logbook", []));
const initialPlume = (() => {
  const raw = safeGetJSON<unknown>("fitz-plume", "stock");
  const progress = { visitedDossiers: loadVisitedDossiers(), shardsCollected: safeGetJSON<number[]>("fitz-shards", []), badges: initialBadges };
  return typeof raw === "string" && plumeAllowed(raw, progress, hasPlumeColour) ? raw : "stock";
})();
```

In the store object:

```ts
    badges: initialBadges,
    plumeColor: initialPlume,
    logbookOpen: false,
    recordBadge: (id) => {
      if (!isRecordable(id) || get().badges.some((b) => b.id === id)) return;
      const next = [...get().badges, { id, at: todayStamp() }];
      safeSetJSON("fitz-logbook", next);
      set({ badges: next });
      const entry = LOGBOOK.find((e) => e.id === id);
      get().sendBroadcast(badgeLine(id, entry?.plume ? PLUME_COLORS[id]?.name ?? null : null));
    },
    setPlumeColor: (id) => {
      const s = get();
      const progress = { visitedDossiers: s.visitedDossiers, shardsCollected: s.shardsCollected, badges: s.badges };
      if (!plumeAllowed(id, progress, hasPlumeColour) || s.plumeColor === id) return;
      safeSetJSON("fitz-plume", id);
      set({ plumeColor: id });
    },
    setLogbookOpen: (v) => { if (get().logbookOpen !== v) set({ logbookOpen: v }); },
```

5. In `setOrbitLocked`, at the end of the locking path (after whichever `set({ isOrbitLocked: true, ... })` branch ran), add:

```ts
      if (zone === "contact") get().recordBadge("contact");
```

(`zone` is the existing `get().activeZone` local in that function.)

6. `src/audio/soundManager.ts`, after `oreTick`:

```ts
  /** Logbook badge earned: bright three-note rise */
  badge() {
    [784, 988, 1318].forEach((f, i) => setTimeout(() => this.blip("triangle", f, 0.12, 0.07), i * 70));
  }
```

7. `src/hooks/useSound.ts`, add to the `unsubs` array:

```ts
      useSpaceStore.subscribe(
        (s) => s.badges.length,
        (n, prev) => { if (n > prev) soundManager.badge(); }
      ),
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/spaceStore.test.ts && npx tsc -b && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/spaceStore.ts src/hooks/useSound.ts src/audio/soundManager.ts tests/spaceStore.test.ts
git commit -m "feat(logbook): store badges, plume colour and panel state; badge chime

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Badge hooks

**Files:**
- Modify: `src/utils/mining.ts` (`addOre` returns `crystals`)
- Modify: `src/components/canvas/AsteroidBelt.tsx`, `Spaceship.tsx`, `Scanner.tsx`, `RingCourse.tsx`, `WorldEventDirector.tsx`
- Test: `tests/mining.test.ts`

**Interfaces:**
- Consumes: `recordBadge` (Task 3); `convoySighted` (Task 1); `convoyShipOffsetAt`, `CONVOY_APPROACH_S`, `CONVOY_ORBIT_S` (`src/utils/worldEvents.ts`); `worldEventElapsed` (`src/store/spaceStore.ts`).
- Produces: `addOre(fuel, ore, absorbed): { fuel: number; ore: number; crystals: number }`.

- [ ] **Step 1: Failing test for the ore rollover**

Append to `tests/mining.test.ts`, in `describe("addOre")`:

```ts
  it("reports how many whole crystals' worth this call completed", () => {
    expect(addOre(0, 14, 1).crystals).toBe(0);
    expect(addOre(0, 15, 1).crystals).toBe(1);
    expect(addOre(0, 15, 18).crystals).toBe(2);
  });
```

Run: `npx vitest run tests/mining.test.ts`
Expected: FAIL (`crystals` undefined).

- [ ] **Step 2: Implement `crystals`**

In `src/utils/mining.ts`:

```ts
/** Fuel and ore counter after `absorbed` pebbles, and how many whole crystals' worth just completed. Pure. */
export function addOre(fuel: number, ore: number, absorbed: number): { fuel: number; ore: number; crystals: number } {
  return {
    fuel: Math.min(FUEL_MAX, fuel + absorbed * ORE_FUEL),
    ore: (ore + absorbed) % ORE_PER_CRYSTAL,
    crystals: Math.floor((ore + absorbed) / ORE_PER_CRYSTAL),
  };
}
```

Run the mining tests → PASS.

- [ ] **Step 3: Wire the five hooks**

1. `AsteroidBelt.tsx`, in the `absorbed > 0` block, after `const store = useSpaceStore.getState();`:

```ts
        if (next.crystals > 0) store.recordBadge("ore");
```

2. `Spaceship.tsx`, after `if (sling.whoosh) soundManager.whoosh();`:

```ts
    if (sling.whoosh) store.recordBadge("slingshot");
```

3. `Scanner.tsx`, inside `if (scanState.progress >= 1) {`, after the broadcast and beep:

```ts
        if (near.id === "comet_visitor") store.recordBadge("comet");
```

4. `RingCourse.tsx`, in `onEvent`'s `next.phase === "finished"` branch, after `const t = next.time;`:

```ts
      if (t < 60) s.recordBadge("ring");
```

5. `WorldEventDirector.tsx`. Merge into the imports: `convoyShipOffsetAt, CONVOY_APPROACH_S, CONVOY_ORBIT_S` from `../../utils/worldEvents`, `worldEventElapsed` from the store, `convoySighted` from `../../utils/logbook`. Add module-level scratch:

```ts
/** Convoy ship positions for the logbook sighting check (reused). */
const sightShips = [0, 1, 2].map(() => ({ x: 0, y: 0, z: 0 }));
const sightOff = { x: 0, y: 0, z: 0 };
```

In the component, `const nextSightAt = useRef(0);`, and at the end of the frame loop:

```ts
    // Logbook: a convoy watched up close during its delivery orbit (twice a second).
    const conv = s.worldEvent?.convoy;
    const convElapsed = worldEventElapsed("convoy");
    if (conv && convElapsed !== null && convElapsed >= CONVOY_APPROACH_S
      && convElapsed <= CONVOY_APPROACH_S + CONVOY_ORBIT_S && now >= nextSightAt.current) {
      nextSightAt.current = now + 0.5;
      const c = bodies[conv.planet];
      for (let k = 0; k < 3; k++) {
        convoyShipOffsetAt(sightOff, conv.plan, convElapsed, k as 0 | 1 | 2);
        sightShips[k].x = c.x + sightOff.x; sightShips[k].y = c.y + sightOff.y; sightShips[k].z = c.z + sightOff.z;
      }
      if (convoySighted(flight, sightShips)) s.recordBadge("convoy");
    }
```

(`now` is the loop's existing `gameTime(elapsed)`.)

- [ ] **Step 4: Verify**

Run: `npm test && npx tsc -b && npm run lint`
Expected: green. (`recordBadge` is unit-tested in Task 3; the hooks are proven in the Task 9 real-browser pass.)

- [ ] **Step 5: Commit**

```bash
git add src/utils/mining.ts src/components/canvas/AsteroidBelt.tsx src/components/canvas/Spaceship.tsx src/components/canvas/Scanner.tsx src/components/canvas/RingCourse.tsx src/components/canvas/WorldEventDirector.tsx tests/mining.test.ts
git commit -m "feat(logbook): record badges where slingshots, scans, laps, ore and convoys happen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Apply the plume colour to the exhaust

**Files:**
- Modify: `src/components/canvas/Spaceship.tsx`

**Interfaces:**
- Consumes: store `plumeColor` (Task 3); `PLUME_COLORS`, `sparkBase` (Task 2).

- [ ] **Step 1: Module scratch and imports**

```ts
import { PLUME_COLORS, sparkBase } from "../../data/plumeColors";

/** Spark base colour for the current plume (written on plume change, read by the spark loop). */
const sparkRGB: [number, number, number] = [0.55, 1, 1];
```

- [ ] **Step 2: Apply on change**

After `engineMat`'s `useMemo`:

```ts
  const engineStockEmissive = useMemo(() => engineMat?.emissive.clone() ?? new THREE.Color("#00f0ff"), [engineMat]);
```

After `plumeMaterials` and `engineLightRef` are declared:

```ts
  // Logbook plume colour (spec §5): uniform and CPU colour changes only, once
  // per change. The hot white core stays; the cool end, sparks, engine light
  // and nozzle glow take the colour. Stock restores the original cyan.
  useEffect(() => {
    const apply = (id: string) => {
      const hex = (PLUME_COLORS[id] ?? PLUME_COLORS.stock).hex;
      for (const m of plumeMaterials) (m.uniforms.uColor.value as THREE.Color).set(hex);
      if (id === "stock") { sparkRGB[0] = 0.55; sparkRGB[1] = 1; sparkRGB[2] = 1; } else sparkBase(hex, sparkRGB);
      if (engineLightRef.current) engineLightRef.current.color.set(id === "stock" ? "#00f0ff" : hex);
      if (engineMat) engineMat.emissive.copy(id === "stock" ? engineStockEmissive : new THREE.Color(hex));
    };
    apply(useSpaceStore.getState().plumeColor);
    return useSpaceStore.subscribe((s) => s.plumeColor, apply);
  }, [plumeMaterials, engineMat, engineStockEmissive]);
```

(`new THREE.Color` here runs only on a plume change, not per frame.) Note: `ShaderMaterial` built by `makePlumeMaterial` stores a *clone* of the colour in `uColor`, so `.set` on it does not touch the shared default.

- [ ] **Step 3: Sparks read the base**

In the spark loop, replace

```ts
        cols[idx] = 0.55 * b; cols[idx + 1] = 1.0 * b; cols[idx + 2] = 1.0 * b;
```

with

```ts
        cols[idx] = sparkRGB[0] * b; cols[idx + 1] = sparkRGB[1] * b; cols[idx + 2] = sparkRGB[2] * b;
```

- [ ] **Step 4: Verify**

Run: `npx tsc -b && npm test && npm run lint`
Expected: green. (Task 8's e2e asserts `uColor` changes and the program count does not.)

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/Spaceship.tsx
git commit -m "feat(logbook): the chosen plume colour tints the whole exhaust

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: HUD tracker and milestones

**Files:**
- Create: `src/components/layout/LogbookTracker.tsx`
- Modify: `src/utils/logbook.ts` (milestone helper), `src/components/layout/HUDOverlay.tsx`
- Test: `tests/logbook.test.ts`

**Interfaces:**
- Consumes: Task 1 model; store `badges`, `visitedDossiers`, `shardsCollected`, `reducedMotion`, `setLogbookOpen`.
- Produces: `milestoneFor(prev: LogbookProgress, next: LogbookProgress): "essentials" | "all" | null`; `<LogbookTracker />` with `data-testid="logbook-tracker"`.

- [ ] **Step 1: Failing test for milestones**

In `tests/logbook.test.ts`, add `milestoneFor` to the import from `../src/utils/logbook`, and append:

```ts
describe("milestoneFor", () => {
  const essentials: LogbookProgress = { ...withBadges("contact"), visitedDossiers: projects.map((p) => p.id) };
  const all: LogbookProgress = {
    ...withBadges("contact", "slingshot", "comet", "ring", "ore", "convoy"),
    visitedDossiers: projects.map((p) => p.id), shardsCollected: [1, 2, 3],
  };
  it("fires on the transition into essentials-done and into all-done", () => {
    expect(milestoneFor(withBadges("contact"), essentials)).toBe("essentials");
    expect(milestoneFor({ ...all, badges: all.badges.slice(0, -1) }, all)).toBe("all");
  });
  it("fires no milestone for progress that was already there", () => {
    expect(milestoneFor(essentials, essentials)).toBeNull();
    expect(milestoneFor(all, all)).toBeNull();
    expect(milestoneFor(empty, withBadges("comet"))).toBeNull();
  });
});
```

Run: `npx vitest run tests/logbook.test.ts`
Expected: FAIL (`milestoneFor` missing).

- [ ] **Step 2: Implement `milestoneFor`**

Append to `src/utils/logbook.ts`:

```ts
/** The milestone a progress change crosses (everything-done wins); null if none was newly crossed. */
export function milestoneFor(prev: LogbookProgress, next: LogbookProgress): "essentials" | "all" | null {
  if (allDone(next) && !allDone(prev)) return "all";
  if (essentialsDone(next) && !essentialsDone(prev)) return "essentials";
  return null;
}
```

Run → PASS.

- [ ] **Step 3: Create `LogbookTracker.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useSpaceStore } from "../../store/spaceStore";
import { logbookCount, nextGoal, milestoneFor, type LogbookProgress } from "../../utils/logbook";
import { soundManager } from "../../audio/soundManager";

const TOUR_LINE = "TOUR COMPLETE // THE PILOT'S RÉSUMÉ AND CONTACT ARE ONE CLICK AWAY";
const ALL_LINE = "LOGBOOK COMPLETE // ALL PLUMES UNLOCKED. FLY PRETTY, PILOT";

/**
 * HUD line: progress and the next goal (spec §4.1). Re-renders only when
 * progress changes. Also fires the two milestones, once, and only on a
 * transition during this visit: a returning visitor's stored progress is the
 * starting point, never an announcement.
 */
export default function LogbookTracker() {
  const badges = useSpaceStore((s) => s.badges);
  const visitedDossiers = useSpaceStore((s) => s.visitedDossiers);
  const shardsCollected = useSpaceStore((s) => s.shardsCollected);
  const reducedMotion = useSpaceStore((s) => s.reducedMotion);
  const progress = useMemo<LogbookProgress>(
    () => ({ badges, visitedDossiers, shardsCollected }), [badges, visitedDossiers, shardsCollected]);
  const { done, total } = logbookCount(progress);
  const goal = nextGoal(progress);

  // Previous progress, for the pulse and the milestones.
  const prev = useRef(progress);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = progress;
    if (was === progress) return;
    const m = milestoneFor(was, progress);
    if (m === "all") { soundManager.fanfare(); useSpaceStore.getState().sendBroadcast(ALL_LINE); }
    else if (m === "essentials") useSpaceStore.getState().sendBroadcast(TOUR_LINE);
    if (logbookCount(progress).done > logbookCount(was).done && !reducedMotion) {
      setPulse(true);
      const id = setTimeout(() => setPulse(false), 1500);
      return () => clearTimeout(id);
    }
  }, [progress, reducedMotion]);

  const complete = goal === null;
  return (
    <button type="button" data-testid="logbook-tracker"
      onClick={() => useSpaceStore.getState().setLogbookOpen(true)}
      aria-label={complete ? `Logbook complete, ${done} of ${total}. Open logbook` : `Logbook ${done} of ${total}. Next: ${goal.title}. Open logbook`}
      className={`pointer-events-auto text-left cursor-pointer hover:text-white transition-colors ${complete ? "text-accent" : "text-white/70"} ${pulse ? "animate-pulse text-primary" : ""}`}>
      <span className="hidden sm:inline">LOGBOOK {done}/{total}</span>
      <span className="sm:hidden">LOG {done}/{total}</span>
      {complete
        ? <span> // COMPLETE</span>
        : <>
            <span className="hidden sm:inline">  &gt; NEXT: {goal.hint}</span>
            <span className="sm:hidden"> &gt; {goal.hintShort}</span>
          </>}
    </button>
  );
}
```

Note: the milestone only fires when `progress` changes while mounted. HUDOverlay unmounts in photo mode and the classic résumé, but progress cannot change there (nothing is recorded while the scene is frozen or unmounted), so no milestone is lost. A remount starts from the current progress, so it never re-announces.

- [ ] **Step 4: Mount it**

In `HUDOverlay.tsx`, import `LogbookTracker` and render it directly after the `SHARDS:` line:

```tsx
        <div>SHARDS: {shardsCollected.length}/{SHARDS.length}</div>
        <LogbookTracker />
```

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run tests/logbook.test.ts && npx tsc -b && npm test && npm run lint`
Expected: green.

```bash
git add src/utils/logbook.ts src/components/layout/LogbookTracker.tsx src/components/layout/HUDOverlay.tsx tests/logbook.test.ts
git commit -m "feat(logbook): HUD tracker with next goal; tour and logbook-complete milestones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The panel, plume picker and ways to open it

**Files:**
- Create: `src/components/layout/LogbookPanel.tsx`
- Modify: `src/App.tsx` (L key; mount), `src/components/layout/HUDOverlay.tsx` (button; controls hint), `src/utils/gamepad.ts`, `src/hooks/useGamepadInput.ts`
- Test: `tests/gamepad.test.ts`

**Interfaces:**
- Consumes: Task 1 model; Task 2 colours; Task 3 store.
- Produces: `PadAction` gains `{ kind: "logbook" }` (button X, index 2); `<LogbookPanel />` with `data-testid="logbook-panel"`, heading `id="logbook-title"`, swatch radios `data-testid="plume-<id>"`; HUD button `data-testid="logbook-button"`.

- [ ] **Step 1: Failing gamepad test**

Append to `tests/gamepad.test.ts`:

```ts
describe("logbook on the pad", () => {
  it("X opens the logbook on its press edge", () => {
    const press = (...i: number[]) => Array.from({ length: 16 }, (_, k) => i.includes(k));
    expect(padActions(press(), press(2))).toEqual([{ kind: "logbook" }]);
    expect(padActions(press(2), press(2))).toEqual([]);
  });
});
```

Run: `npx vitest run tests/gamepad.test.ts`
Expected: FAIL.

- [ ] **Step 2: Gamepad X**

`src/utils/gamepad.ts`:
- `export type PadAction = { kind: "photo" } | { kind: "close" } | { kind: "logbook" } | { kind: "jump"; index: number };`
- Button constants: `const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7;`
- In `padActions`, after the B line: `if (edge(X)) out.push({ kind: "logbook" });`
- Mention "2 X logbook" in the header comment's button list.

`src/hooks/useGamepadInput.ts`, in `act`, before the final jump branch:

```ts
      else if (a.kind === "logbook") { if (!s.photoMode && !s.isOrbitLocked) s.setLogbookOpen(!s.logbookOpen); }
```

and add `X LOGBOOK` to `LINKED_MESSAGE` after `Y PHOTO`.

Run the gamepad tests → PASS.

- [ ] **Step 3: Create `LogbookPanel.tsx`**

```tsx
import { useEffect, useMemo, useRef } from "react";
import { Lock, Check } from "lucide-react";
import { useSpaceStore } from "../../store/spaceStore";
import { LOGBOOK, entryDone, logbookCount, plumeAllowed, type LogbookProgress } from "../../utils/logbook";
import { PLUME_COLORS, hasPlumeColour } from "../../data/plumeColors";

/**
 * The pilot logbook (spec §4.3): a non-modal sheet (flight keeps running)
 * listing essentials and flight badges, with the plume picker. Esc closes it;
 * focus moves to its heading on open and back to the opener on close. It
 * closes itself when a dossier opens, photo mode starts or the résumé opens.
 */
export default function LogbookPanel() {
  const open = useSpaceStore((s) => s.logbookOpen);
  const badges = useSpaceStore((s) => s.badges);
  const visitedDossiers = useSpaceStore((s) => s.visitedDossiers);
  const shardsCollected = useSpaceStore((s) => s.shardsCollected);
  const plumeColor = useSpaceStore((s) => s.plumeColor);
  const isOrbitLocked = useSpaceStore((s) => s.isOrbitLocked);
  const photoMode = useSpaceStore((s) => s.photoMode);
  const showClassicCV = useSpaceStore((s) => s.showClassicCV);
  const progress = useMemo<LogbookProgress>(
    () => ({ badges, visitedDossiers, shardsCollected }), [badges, visitedDossiers, shardsCollected]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && (isOrbitLocked || photoMode || showClassicCV)) useSpaceStore.getState().setLogbookOpen(false);
  }, [open, isOrbitLocked, photoMode, showClassicCV]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") useSpaceStore.getState().setLogbookOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener.current?.focus?.();
    };
  }, [open]);

  if (!open || photoMode || showClassicCV) return null;
  const { done, total } = logbookCount(progress);
  const earnedAt = (id: string) => badges.find((b) => b.id === id)?.at;
  const list = (kind: "essential" | "badge") => LOGBOOK.filter((e) => e.section === kind).map((e) => {
    const isDone = entryDone(e, progress);
    const at = earnedAt(e.id);
    const swatch = e.plume ? PLUME_COLORS[e.id]?.hex : undefined;
    return (
      <li key={e.id} className="flex items-start gap-2 py-1"
        aria-label={isDone ? `${e.title}, ${at ? `earned ${at}` : "done"}` : `${e.title}, not yet: ${e.hint.toLowerCase()}`}>
        <span aria-hidden="true" className={`mt-0.5 ${isDone ? "text-primary" : "text-white/30"}`}>
          {isDone ? <Check className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
        </span>
        <span className="flex-1" aria-hidden="true">
          <span className={isDone ? "text-white" : "text-white/60"}>{e.title}</span>
          <span className="block text-[9px] text-white/40">{isDone ? (at ? `EARNED ${at}` : "DONE") : e.hint}</span>
        </span>
        {swatch && <span aria-hidden="true" className="mt-1 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: swatch, opacity: isDone ? 1 : 0.3 }} />}
      </li>
    );
  });

  return (
    <div role="dialog" aria-modal="false" aria-labelledby="logbook-title" data-testid="logbook-panel"
      className="fixed z-[46] pointer-events-auto font-mono text-[10px] glass-card bg-black/85 border border-white/10 overflow-y-auto
        inset-x-3 bottom-3 max-h-[70vh] rounded-2xl p-4
        sm:inset-x-auto sm:right-6 sm:top-24 sm:bottom-auto sm:w-[380px] sm:max-h-[calc(100vh-8rem)]">
      <div className="flex items-baseline justify-between mb-3">
        <h2 id="logbook-title" ref={headingRef} tabIndex={-1} className="text-primary text-xs outline-none">PILOT LOGBOOK</h2>
        <span className="text-white/60">{done} / {total}</span>
      </div>
      <div className="text-white/40 mb-1">ESSENTIALS</div>
      <ul className="mb-3">{list("essential")}</ul>
      <div className="text-white/40 mb-1">FLIGHT BADGES</div>
      <ul className="mb-3">{list("badge")}</ul>
      <fieldset>
        <legend className="text-white/40 mb-1">ENGINE PLUME</legend>
        <div className="flex flex-wrap gap-2">
          {Object.entries(PLUME_COLORS).map(([id, c]) => {
            const allowed = plumeAllowed(id, progress, hasPlumeColour);
            const badge = LOGBOOK.find((e) => e.id === id);
            return (
              <label key={id}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${plumeColor === id ? "border-primary/60" : "border-white/10"} ${allowed ? "cursor-pointer" : "opacity-40 cursor-not-allowed"}`}
                title={allowed ? c.name : `Earn ${badge?.title ?? id} to unlock`}>
                <input type="radio" name="plume" value={id} data-testid={`plume-${id}`} className="sr-only"
                  checked={plumeColor === id} disabled={!allowed}
                  aria-label={allowed ? `${c.name} plume` : `${c.name} plume, locked: earn ${badge?.title ?? id}`}
                  onChange={() => useSpaceStore.getState().setPlumeColor(id)} />
                <span aria-hidden="true" className="w-3 h-3 rounded-full" style={{ backgroundColor: c.hex }} />
                <span aria-hidden="true">{c.name}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <button type="button" onClick={() => useSpaceStore.getState().setLogbookOpen(false)}
        className="mt-3 text-white/50 hover:text-white">CLOSE [L / ESC]</button>
    </div>
  );
}
```

- [ ] **Step 4: Ways to open it**

`src/App.tsx`:
- Import `LogbookPanel` and mount `<LogbookPanel />` right after the `HUDOverlay` line (unconditionally: it hides itself in photo mode and the classic résumé, and closes itself on lock).
- In the global key handler, after the KeyB block:

```ts
      if (e.code === "KeyL" && !s.photoMode && !s.isOrbitLocked) {
        s.setLogbookOpen(!s.logbookOpen);
        return;
      }
```

`src/components/layout/HUDOverlay.tsx`: import `BookOpen` from `lucide-react`. Add, first in the bottom-left button row:

```tsx
        <button data-testid="logbook-button" onClick={() => useSpaceStore.getState().setLogbookOpen(true)}
          aria-label="Open pilot logbook"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/5 bg-white/2 text-white/50 hover:text-primary hover:border-primary/20 transition-all duration-300">
          <BookOpen className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">LOGBOOK</span>
        </button>
```

and in the desktop controls card, after the PHOTO_MODE entry (inside the `!isCoarse` fragment):

```tsx
            <div className="w-[1px] bg-white/5" />
            <div className="flex flex-col">
              <span className="text-white/45">LOGBOOK</span>
              <span className="text-white">{pad ? "X" : "L"}</span>
            </div>
```

- [ ] **Step 5: Verify and commit**

Run: `npx tsc -b && npm test && npm run lint`
Expected: green.

```bash
git add src/components/layout/LogbookPanel.tsx src/App.tsx src/components/layout/HUDOverlay.tsx src/utils/gamepad.ts src/hooks/useGamepadInput.ts tests/gamepad.test.ts
git commit -m "feat(logbook): logbook panel with plume picker; L, HUD button and gamepad X

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end probe

**Files:**
- Create: `tests/e2e/logbook.probe.mjs`
- Modify: `tests/e2e/run.mjs` (register after `mechanics`)

**Interfaces:**
- Consumes: `withPage`, `settle`, `readStore`, `pollUntil` (`harness.mjs`); `KnownDevices` (`puppeteer-core`); test ids from Tasks 6–7.

- [ ] **Step 1: Write the probe**

```js
import { withPage, settle, readStore, pollUntil } from "./harness.mjs";
import { KnownDevices } from "puppeteer-core";

const tracker = (page) => page.evaluate(() => document.querySelector('[data-testid="logbook-tracker"]')?.textContent ?? "");
const liveText = (page) => page.evaluate(() => document.querySelector("[aria-live]")?.textContent ?? "");
const ready = (page) => page.waitForFunction(() => window.__fitz?.store.getState().sceneReady, { timeout: 60_000 });

async function desktop(page, checks) {
  await page.evaluate(() => ["fitz-logbook", "fitz-plume", "fitz-dossiers", "fitz-shards"].forEach((k) => localStorage.removeItem(k)));
  await page.reload();
  await ready(page);
  checks.check("fresh tracker shows 0/10 and the first essential", /LOGBOOK 0\/10.*RUANGRAPI/.test(await tracker(page)), await tracker(page));

  // Jump to planet 1 (ruangrapi): its dossier opens.
  await page.keyboard.press("Digit1");
  const docked = await pollUntil(async () => (await readStore(page)).isOrbitLocked, { timeoutMs: 15_000, intervalMs: 200 });
  checks.check("jump docks at the first planet", docked.ok);
  await page.keyboard.press("KeyL");
  await settle(page, 300);
  checks.check("L does nothing while a dossier is open", !(await readStore(page)).logbookOpen);
  await page.keyboard.press("Escape");
  await settle(page, 2500);
  checks.check("the dossier essential is ticked and the tracker advances",
    /LOGBOOK 1\/10.*FLIGHT-SIM CV/.test(await tracker(page)), await tracker(page));

  // Record two badges through the store, as the hooks do.
  await page.evaluate(() => window.__fitz.store.getState().recordBadge("slingshot"));
  await settle(page, 400);
  checks.check("a recorded badge is announced to screen readers", /SLINGSHOT EARNED/.test(await liveText(page)), await liveText(page));
  await page.evaluate(() => window.__fitz.store.getState().recordBadge("comet"));
  await settle(page, 400);
  checks.check("badges raise the count", /LOGBOOK 3\/10/.test(await tracker(page)), await tracker(page));

  // Panel: L opens with focus on the heading; Esc closes; the HUD button opens.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("KeyL");
  await settle(page, 300);
  const focus = await page.evaluate(() => document.activeElement?.id);
  checks.check("L opens the panel with focus on its heading", focus === "logbook-title", `focus=${focus}`);
  await page.keyboard.press("Escape");
  await settle(page, 300);
  checks.check("Esc closes the panel", !(await readStore(page)).logbookOpen);
  await page.click('[data-testid="logbook-button"]');
  await settle(page, 300);
  checks.check("the HUD button opens the panel", (await readStore(page)).logbookOpen);

  // Plume: gold changes uColor and adds no shader program; a locked one is disabled.
  const before = await page.evaluate(() => window.__fitz.gl.info.programs.length);
  await page.click('[data-testid="plume-slingshot"]');
  await settle(page, 600);
  const after = await page.evaluate(() => {
    let hex = null;
    window.__fitz.scene.traverse((o) => {
      const u = o.material?.uniforms;
      if (!hex && u?.uColor && u?.uPower && o.name !== "TractorBeamCone") hex = u.uColor.value.getHexString();
    });
    return { hex, programs: window.__fitz.gl.info.programs.length, plume: window.__fitz.store.getState().plumeColor };
  });
  checks.check("picking gold sets the plume colour", after.plume === "slingshot" && after.hex === "ffc23d", JSON.stringify(after));
  checks.check("a plume colour adds no shader program", after.programs === before, `before=${before} after=${after.programs}`);
  checks.check("a locked plume cannot be picked",
    await page.evaluate(() => document.querySelector('[data-testid="plume-ring"]')?.disabled === true));

  // Persistence, the tamper guard, and no announcements for old progress.
  await page.evaluate(() => localStorage.setItem("fitz-plume", JSON.stringify("ring")));
  await page.reload();
  await ready(page);
  await settle(page, 1000);
  const st = await readStore(page);
  checks.check("progress survives a reload", st.badges.length === 2 && /LOGBOOK 3\/10/.test(await tracker(page)), await tracker(page));
  checks.check("a tampered plume for a locked badge falls back to stock", st.plumeColor === "stock", `plume=${st.plumeColor}`);
  checks.check("a reload announces nothing for old progress", !/LOGBOOK \/\/|TOUR COMPLETE/.test(await liveText(page)), await liveText(page));
}

async function phone(page, checks) {
  const rect = (id) => page.evaluate((i) => {
    const e = document.querySelector(`[data-testid="${i}"]`);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null;
  }, id);
  checks.check("phone: the tracker shows", !!(await rect("logbook-tracker")));
  checks.check("phone: the logbook button shows", !!(await rect("logbook-button")));
  await page.evaluate(() => window.__fitz.store.getState().setLogbookOpen(true));
  await settle(page, 400);
  const panel = await rect("logbook-panel");
  const vh = await page.evaluate(() => window.innerHeight);
  checks.check("phone: the panel opens as a bottom sheet", !!panel && panel.b <= vh && panel.t > vh * 0.25, JSON.stringify(panel));
  const covered = [];
  for (const id of ["touch-boost", "touch-beam", "touch-rise", "touch-dive"]) {
    const b = await rect(id);
    if (b && panel && b.l < panel.r && panel.l < b.r && b.t < panel.b && panel.t < b.b) covered.push(id);
  }
  checks.check("phone: the open panel does not cover visible flight buttons", covered.length === 0, covered.join(","));
}

export default async function run() {
  const checks = await withPage({ label: "logbook" }, desktop);
  const p = await withPage({ label: "logbook (phone)", device: KnownDevices["iPhone 13"] }, phone);
  checks.results.push(...p.results);
  return checks;
}
```

If the phone geometry check fails because the bottom sheet overlaps the touch buttons, make a ruling and ledger it. Either hide `TouchControls` while `logbookOpen` (the panel is then the only thing on screen, which is reasonable on a phone), or cap the sheet's height so it ends above the button cluster. Prefer hiding the controls. Pick one; don't weaken the check.

- [ ] **Step 2: Register and run**

Add `"logbook"` after `"mechanics"` in `tests/e2e/run.mjs`. Close any browser tab rendering the app.

Run: `npm run test:e2e -- logbook`
Expected: all checks pass. Fix causes in the owning task's code, not thresholds.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/logbook.probe.mjs tests/e2e/run.mjs
git commit -m "test(e2e): logbook probe — tracker, panel, badges, plume, persistence, phone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Changelog data and seen state

**Files:**
- Create: `src/data/changelog.ts`
- Modify: `src/store/spaceStore.ts` (`changelogOpen`, `changelogSeen`, mutual exclusion with the logbook)
- Test: `tests/changelog.test.ts`, `tests/spaceStore.test.ts`

**Interfaces:**
- Produces: `interface ChangelogEntry { id: string; date: string; pr: number; title: string; what: string; why: string; how: string }`; `CHANGELOG: readonly ChangelogEntry[]` (newest first); `PR_URL = "https://github.com/fitzfitz/3d-portfolio/pull/"`; `hasUnseen(newestId: string, seen: string): boolean`. Store: `changelogOpen: boolean`, `setChangelogOpen(v: boolean): void`, `changelogSeen: string`, `markChangelogSeen(): void`; `setLogbookOpen(true)` now also closes the changelog and vice versa.

- [ ] **Step 1: Write the failing tests**

Create `tests/changelog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CHANGELOG, hasUnseen, PR_URL } from "../src/data/changelog";

describe("CHANGELOG", () => {
  it("is newest first with valid ISO dates", () => {
    for (const e of CHANGELOG) expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (let i = 1; i < CHANGELOG.length; i++) expect(CHANGELOG[i - 1].date >= CHANGELOG[i].date).toBe(true);
  });
  it("has unique ids that start with their date, and unique positive PR numbers", () => {
    expect(new Set(CHANGELOG.map((e) => e.id)).size).toBe(CHANGELOG.length);
    for (const e of CHANGELOG) expect(e.id.startsWith(e.date)).toBe(true);
    const prs = CHANGELOG.map((e) => e.pr);
    expect(new Set(prs).size).toBe(prs.length);
    for (const n of prs) expect(Number.isInteger(n) && n > 0).toBe(true);
  });
  it("answers what, why and how in short plain text", () => {
    for (const e of CHANGELOG) {
      expect(e.title.split(" ").length, e.id).toBeLessThanOrEqual(4);
      expect(e.what.length, `${e.id} what`).toBeGreaterThan(0);
      expect(e.what.length, `${e.id} what`).toBeLessThanOrEqual(220);
      expect(e.why.length, `${e.id} why`).toBeGreaterThan(0);
      expect(e.why.length, `${e.id} why`).toBeLessThanOrEqual(220);
      expect(e.how.length, `${e.id} how`).toBeGreaterThan(0);
      expect(e.how.length, `${e.id} how`).toBeLessThanOrEqual(240);
    }
  });
  it("starts with October 2026 and covers every PR from #1 up", () => {
    expect(CHANGELOG.at(-1)!.date >= "2026-10-01").toBe(true);
    const prs = new Set(CHANGELOG.map((e) => e.pr));
    for (let n = 1; n <= Math.max(...prs); n++) expect(prs.has(n), `PR #${n}`).toBe(true);
  });
  it("links PRs on GitHub", () => {
    expect(PR_URL).toBe("https://github.com/fitzfitz/3d-portfolio/pull/");
  });
});

describe("hasUnseen", () => {
  it("is true only when the newest entry differs from the one last seen", () => {
    expect(hasUnseen("b", "a")).toBe(true);
    expect(hasUnseen("b", "b")).toBe(false);
  });
});
```

Append to `tests/spaceStore.test.ts`, inside `describe("spaceStore")` (and add `changelogOpen: false,` to the `beforeEach` literal):

```ts
  it("the logbook and the changelog never stay open together", () => {
    const s = useSpaceStore.getState();
    s.setLogbookOpen(true);
    s.setChangelogOpen(true);
    expect(useSpaceStore.getState()).toMatchObject({ changelogOpen: true, logbookOpen: false });
    s.setLogbookOpen(true);
    expect(useSpaceStore.getState()).toMatchObject({ changelogOpen: false, logbookOpen: true });
  });

  it("markChangelogSeen stores the newest entry id", () => {
    useSpaceStore.setState({ changelogSeen: "old" });
    useSpaceStore.getState().markChangelogSeen();
    expect(useSpaceStore.getState().changelogSeen).toBe(CHANGELOG[0].id);
  });
```

(import `CHANGELOG` from `../src/data/changelog`).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/changelog.test.ts tests/spaceStore.test.ts`
Expected: FAIL (module not found / missing members).

- [ ] **Step 3: Implement `src/data/changelog.ts`**

```ts
/**
 * Patch notes (spec §8): one entry per shipped update, newest first, from
 * October 2026. Written for visitors: what changed, why, and how, in plain
 * language. WHEN is the date plus the PR. Each feature PR adds its entry.
 * tests/changelog.test.ts guards the format.
 */
export interface ChangelogEntry { id: string; date: string; pr: number; title: string; what: string; why: string; how: string }

export const PR_URL = "https://github.com/fitzfitz/3d-portfolio/pull/";

export const CHANGELOG: readonly ChangelogEntry[] = [
  { id: "2026-10-13-pilot-logbook", date: "2026-10-13", pr: 18, title: "Pilot Logbook", what: "A logbook (L) tracks the essentials, the three project dossiers and the contact portal, plus six flight badges that each unlock an engine-plume colour. These patch notes are new too.", why: "There was plenty to do but nothing tied it together, and a visitor in a hurry had no clear path to the parts of the portfolio that matter most.", how: "Progress is derived from what the site already remembers, plus a small saved badge list. Plume colours only change existing shader values, so they cost nothing extra to render." },
  { id: "2026-10-13-flight-feel", date: "2026-10-13", pr: 17, title: "Flight Feel", what: "Planets and the sun now pull on your ship, so you can slingshot past them. A tractor beam (F) reels in crystals and mines belt pebbles, and the edge of space is a quiet nebula haze.", why: "Flying was point-and-thrust: nothing bent your path, and the edge of the map announced itself with a flash and a zap. Space should push back a little.", how: "Gravity is a separate model with its own momentum, layered on the pilot's damped velocity, which had been erasing plain gravity. Safeguards zero it on jumps, warp and docking." },
  { id: "2026-10-12-world-events", date: "2026-10-12", pr: 16, title: "World Events", what: "About 45 seconds in, and every minute or two after, something happens: a comet passes close by, the sun flares, or a cargo convoy flies in formation to the nearest planet.", why: "A visitor who only hovers and reads saw a beautiful but static scene. The universe needed a heartbeat that does not depend on how well you fly.", how: "A seeded event director picks what happens next on the planets' own clock, and checks each comet or convoy route against every planet's drift before it starts. Event objects stay loaded but hidden." },
  { id: "2026-10-12-smoother-startup", date: "2026-10-12", pr: 15, title: "Smoother Startup", what: "Fixed a race that sometimes made the scene appear about five seconds late. Affected loads now come up in roughly 3.5 seconds instead of 8.", why: "When the site decided mid-load that your device needed lighter graphics, it pulled materials out from under the shader compiler, which then waited out its timeout.", how: "An instrumented production build logged disposals and tier switches to find the overlap. The quality downgrade is now queued until shader warm-up finishes, then applied." },
  { id: "2026-10-12-world-reactions", date: "2026-10-12", pr: 14, title: "World Reactions", what: "Cargo ships swerve, flash their lights and hail you on the radio. The jellyfish drifts over if you hover, and bolts if you boost. Asteroid belt rocks part around your ship.", why: "Everything moved on its own schedule and ignored the pilot completely. A living place should notice you, even if it is just a startled jellyfish.", how: "Each reaction is an eased offset layered on top of the existing motion, so no route or orbit changes and every offset springs back to zero. No new materials, draw calls or shaders." },
  { id: "2026-10-12-scale-pass", date: "2026-10-12", pr: 13, title: "Scale Pass", what: "Planets are over three times bigger and the sun now outsizes them. Desktop gets sharper planet maps for close orbits, and the sun no longer glows through planets in front of it.", why: "The sun used to be smaller than the planets, which read as toys, and its god rays drew through any planet that crossed in front of it.", how: "Tests check every fixed object against each planet's full orbit, since bigger worlds swept into shards and asteroids. God rays now fade by how much of the sun the planets cover, computed geometrically." },
  { id: "2026-10-12-beacons-everywhere", date: "2026-10-12", pr: 12, title: "Beacons Everywhere", what: "Visitor beacons now appear on both copies of the site, not only the GitHub Pages one.", why: "The Cloudflare-hosted copy never received the beacon service's address, so visitors there could neither see nor drop beacons.", how: "The public API address moved into a committed production environment file that both hosts' builds read. Emptying that one value is now the single kill switch for the feature." },
  { id: "2026-10-12-visitor-beacons", date: "2026-10-12", pr: 11, title: "Visitor Beacons", what: "Press B to leave a beacon where your ship is. Later visitors see it bobbing in space, and a scan shows its message, the pilot's country and how long ago it was dropped.", why: "Every visitor flew alone. Beacons leave a light trace of who came before, without letting anyone write words onto a CV page.", how: "Messages are picked from a fixed phrase list, never free text. A tiny Cloudflare Worker on a SQLite database rate-limits in one atomic insert and stores only a salted hash of each IP." },
  { id: "2026-10-12-ring-course", date: "2026-10-12", pr: 10, title: "Ring Course", what: "An optional time trial: an amber ring by the spawn pad starts a nine-ring lap through the asteroid belt and back. Your best lap is saved and replayed as a translucent ghost.", why: "Once the dossiers are read there was nothing to master. A lap with a 35-second par gives the flight model a reason to be learned.", how: "A ring counts when the ship's path between two frames crosses its disc, so even warp-speed passes register. The ghost replays a 10 Hz recording, and all nine rings are one instanced draw." },
  { id: "2026-10-12-gamepad-support", date: "2026-10-12", pr: 9, title: "Gamepad Support", what: "Plug in a controller and fly with it: analog steering and throttle, warp, scan, photo mode, and d-pad jumps to each planet. Impacts rumble the pad in Chrome.", why: "A flight sim begs for a stick, and keyboard flying is a skill not every visitor wants to learn just to read about some projects.", how: "The pad is polled once per frame only while one is connected, through a pure mapping with deadzones. It shares one input channel with keyboard and touch without overriding a held key." },
  { id: "2026-10-10-cinematic-scene", date: "2026-10-10", pr: 8, title: "Cinematic Scene", what: "The space between objects got a full pass: a Milky Way sky, tapered engine plumes, a proper warp tunnel, sunlit atmospheres, a granulated sun, and a camera that lags and swings.", why: "The models held up, but the space around them did not. The sky was flat black, the engine trail read as a laser line, and warp looked like confetti.", how: "The galactic sky is painted once into a cube texture, so it costs nothing per frame. The engine plumes are shaders driven by throttle, with shock diamonds. Camera motion switches off under reduced motion." },
  { id: "2026-10-10-cinematic-bodies", date: "2026-10-10", pr: 7, title: "Cinematic Bodies", what: "New hero asteroids with glowing mineral veins, a two-lobed comet nucleus with icy cliffs, and three kinds of moon: cratered rock, fractured ice and volcanic.", why: "Asteroids looked like stacked slabs, the comet like a green wall, and the moons were flat grey. Part bad models, part a rendering bug.", how: "Seeded generators build each model. The fix for squashed rocks reused a lesson from the jellyfish: compressed vertex data was clamped when transforms were baked in, so it is expanded first." },
  { id: "2026-10-10-a-proper-jellyfish", date: "2026-10-10", pr: 6, title: "A Proper Jellyfish", what: "The space jellyfish (press J) now looks like one: a smooth marked bell, frilly arms and 32 hair-thin tentacles. Fuel crystals also regain their tops.", why: "It read as a frosted blob at about 40% of its intended height, and the crystals were sliced off flat. Both had the same hidden cause.", how: "Models are stored as compressed 16-bit positions in a -1 to 1 range. Baking a scale into that storage clamped anything outside it, so geometry is now widened to full floats first." },
  { id: "2026-10-10-original-assets", date: "2026-10-10", pr: 5, title: "Original Assets", what: "The ship, contact portal, fuel crystals and planets are all new, original work: a detailed hero ship, and planets with island archipelagos, night-side city lights and glowing rifts.", why: "Five shipped files had no recorded source or licence, which a public portfolio cannot have. Replacing them was also a chance to make them better.", how: "Every asset comes from a deterministic script, mostly Blender, so it can be rebuilt exactly. A test fails if any shipped file lacks a generator, and city lights use a small night-side shader mask." },
  { id: "2026-10-10-smoother-loading", date: "2026-10-10", pr: 4, title: "Smoother Loading", what: "The freeze as the scene hands over from the loader is roughly a third of what it was. Space also uses fewer lights and has wispier, more structured nebulae.", why: "Startup ran one long blocking compile that stalled the page for half a second or more just as you got control.", how: "Shaders now compile asynchronously, off the main thread where the browser allows, with textures uploaded one at a time. Nebulae use seeded fractal noise sprites, half the overdraw of the old blobs." },
  { id: "2026-10-10-faster-and-sharper", date: "2026-10-10", pr: 3, title: "Faster and Sharper", what: "The site loads far less up front, and résumé-only visitors skip the 3D engine entirely. Edges are anti-aliased, and stars are round, twinkling and varied in brightness.", why: "The first download was 1.6 MB of script before anything appeared, and the asteroid belt drew far more triangles than anyone could see.", how: "The 3D engine is lazy-loaded as a separate bundle, cutting the main one by three quarters. Belt rocks became an 80-triangle instanced stand-in, removing about 87% of triangles in deep space." },
  { id: "2026-10-10-recruiter-path", date: "2026-10-10", pr: 2, title: "Recruiter Path", what: "Keys 1 to 4, or a click on the HUD, jump straight to each project or the contact portal. A waypoint and a progress counter track what you've read, and the placeholder projects are now real work.", why: "Reaching a project required learning to fly, and the content behind it was template filler with invented roles and metrics.", how: "A jump drops the ship into orbit and opens the dossier in under half a second. The waypoint updates without React re-renders, and dossiers became proper dialogs with focus and Esc support." },
  { id: "2026-10-10-first-minute-fixes", date: "2026-10-10", pr: 1, title: "First Minute Fixes", what: "The ship now starts aimed at a planet, the phone HUD stops overlapping itself, and the classic résumé is tidier. A long list of first-minute bugs, from stuck keys to silent mobile audio, is gone.", why: "Holding W at spawn flew away from every planet, and a first-time visitor hit most of these bugs within the first minute, on desktop and phone alike.", how: "Until the first input, the parked ship tracks an intercept course that leads the orbiting planet. Without WebGL, or if the canvas fails, the site falls back to the résumé instead of a blank page." },
];

/** A dot shows when something shipped since the visitor last opened the notes. */
export function hasUnseen(newestId: string, seen: string): boolean {
  return newestId !== seen;
}
```

- [ ] **Step 4: Store changes**

In `src/store/spaceStore.ts`:

- Import `CHANGELOG` from `../data/changelog`.
- `SpaceState`:

```ts
  changelogOpen: boolean;
  setChangelogOpen: (v: boolean) => void;
  /** Newest changelog id the visitor has seen (persisted as fitz-changelog-seen). */
  changelogSeen: string;
  markChangelogSeen: () => void;
```

- Before the store, the first-visit rule (a first-timer gets no dot):

```ts
const initialChangelogSeen = (() => {
  const raw = safeGetJSON<unknown>("fitz-changelog-seen", null);
  if (typeof raw === "string") return raw;
  safeSetJSON("fitz-changelog-seen", CHANGELOG[0].id);
  return CHANGELOG[0].id;
})();
```

- In the store object:

```ts
    changelogOpen: false,
    changelogSeen: initialChangelogSeen,
    setChangelogOpen: (v) => {
      if (get().changelogOpen === v) return;
      set(v ? { changelogOpen: true, logbookOpen: false } : { changelogOpen: false });
    },
    markChangelogSeen: () => {
      const newest = CHANGELOG[0].id;
      if (get().changelogSeen === newest) return;
      safeSetJSON("fitz-changelog-seen", newest);
      set({ changelogSeen: newest });
    },
```

- Change `setLogbookOpen` so opening it closes the changelog:

```ts
    setLogbookOpen: (v) => {
      if (get().logbookOpen === v) return;
      set(v ? { logbookOpen: true, changelogOpen: false } : { logbookOpen: false });
    },
```

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/changelog.test.ts tests/spaceStore.test.ts && npx tsc -b && npm test`
Expected: PASS.

```bash
git add src/data/changelog.ts src/store/spaceStore.ts tests/changelog.test.ts tests/spaceStore.test.ts
git commit -m "feat(changelog): patch notes from October 2026, with seen state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The in-game patch notes panel

**Files:**
- Create: `src/components/layout/ChangelogPanel.tsx`
- Modify: `src/App.tsx` (N key; mount), `src/components/layout/HUDOverlay.tsx` (PATCH NOTES button with the dot; controls hint)

**Interfaces:**
- Consumes: Task 9 data and store.
- Produces: `<ChangelogPanel />` (`data-testid="changelog-panel"`, heading `id="changelog-title"`, one `<article data-testid="changelog-entry">` per entry); HUD button `data-testid="changelog-button"` with `data-testid="changelog-dot"` while unseen.

- [ ] **Step 1: Create `ChangelogPanel.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { useSpaceStore } from "../../store/spaceStore";
import { CHANGELOG, PR_URL } from "../../data/changelog";

/**
 * Patch notes (spec §8.3): a non-modal sheet like the logbook. Each entry
 * answers WHAT, WHY, WHEN and HOW. Opening it marks the newest entry seen.
 * It closes itself when a dossier opens, photo mode starts or the résumé opens.
 */
export default function ChangelogPanel() {
  const open = useSpaceStore((s) => s.changelogOpen);
  const isOrbitLocked = useSpaceStore((s) => s.isOrbitLocked);
  const photoMode = useSpaceStore((s) => s.photoMode);
  const showClassicCV = useSpaceStore((s) => s.showClassicCV);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && (isOrbitLocked || photoMode || showClassicCV)) useSpaceStore.getState().setChangelogOpen(false);
  }, [open, isOrbitLocked, photoMode, showClassicCV]);

  useEffect(() => {
    if (!open) return;
    useSpaceStore.getState().markChangelogSeen();
    opener.current = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") useSpaceStore.getState().setChangelogOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener.current?.focus?.();
    };
  }, [open]);

  if (!open || photoMode || showClassicCV) return null;
  return (
    <div role="dialog" aria-modal="false" aria-labelledby="changelog-title" data-testid="changelog-panel"
      className="fixed z-[46] pointer-events-auto font-mono text-[10px] glass-card bg-black/85 border border-white/10 overflow-y-auto
        inset-x-3 bottom-3 max-h-[70vh] rounded-2xl p-4
        sm:inset-x-auto sm:right-6 sm:top-24 sm:bottom-auto sm:w-[420px] sm:max-h-[calc(100vh-8rem)]">
      <div className="flex items-baseline justify-between mb-3">
        <h2 id="changelog-title" ref={headingRef} tabIndex={-1} className="text-primary text-xs outline-none">PATCH NOTES</h2>
        <span className="text-white/40">{CHANGELOG.length} UPDATES</span>
      </div>
      {CHANGELOG.map((e) => (
        <article key={e.id} data-testid="changelog-entry" className="py-3 border-t border-white/5 first:border-t-0">
          <h3 className="text-white text-[11px] mb-1.5">{e.title.toUpperCase()}</h3>
          <dl className="grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-1 leading-relaxed">
            <dt className="text-white/40">WHAT</dt><dd className="text-white/80">{e.what}</dd>
            <dt className="text-white/40">WHY</dt><dd className="text-white/70">{e.why}</dd>
            <dt className="text-white/40">WHEN</dt>
            <dd className="text-white/70">
              {e.date} · <a href={`${PR_URL}${e.pr}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">PR #{e.pr}</a>
            </dd>
            <dt className="text-white/40">HOW</dt><dd className="text-white/70">{e.how}</dd>
          </dl>
        </article>
      ))}
      <button type="button" onClick={() => useSpaceStore.getState().setChangelogOpen(false)}
        className="mt-2 text-white/50 hover:text-white">CLOSE [N / ESC]</button>
    </div>
  );
}
```

- [ ] **Step 2: Ways to open it**

`src/App.tsx`: import and mount `<ChangelogPanel />` next to `<LogbookPanel />`. In the global key handler, after the KeyL block:

```ts
      if (e.code === "KeyN" && !s.photoMode && !s.isOrbitLocked) {
        s.setChangelogOpen(!s.changelogOpen);
        return;
      }
```

`src/components/layout/HUDOverlay.tsx`: import `ScrollText` from `lucide-react`, `CHANGELOG` and `hasUnseen` from `../../data/changelog`; read `const changelogSeen = useSpaceStore((s) => s.changelogSeen);`. Add after the LOGBOOK button:

```tsx
        <button data-testid="changelog-button" onClick={() => useSpaceStore.getState().setChangelogOpen(true)}
          aria-label={hasUnseen(CHANGELOG[0].id, changelogSeen) ? "Open patch notes, new updates" : "Open patch notes"}
          className="relative flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/5 bg-white/2 text-white/50 hover:text-primary hover:border-primary/20 transition-all duration-300">
          <ScrollText className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">PATCH_NOTES</span>
          {hasUnseen(CHANGELOG[0].id, changelogSeen) && (
            <span data-testid="changelog-dot" aria-hidden="true" className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary" />
          )}
        </button>
```

And in the desktop controls card after the LOGBOOK entry:

```tsx
            <div className="w-[1px] bg-white/5" />
            <div className="flex flex-col">
              <span className="text-white/45">PATCH_NOTES</span>
              <span className="text-white">N</span>
            </div>
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc -b && npm test && npm run lint`
Expected: green.

```bash
git add src/components/layout/ChangelogPanel.tsx src/App.tsx src/components/layout/HUDOverlay.tsx
git commit -m "feat(changelog): in-game patch notes panel; N, HUD button and new-updates dot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Résumé changelog section and e2e

**Files:**
- Create: `src/components/sections/Changelog.tsx`
- Modify: `src/App.tsx` (résumé layout), `src/components/layout/Navbar.tsx` (link), `tests/e2e/logbook.probe.mjs`

**Interfaces:**
- Consumes: Task 9 data.
- Produces: `<section id="changelog">` with one `[data-testid="resume-changelog-entry"]` per entry.

- [ ] **Step 1: Create the section**

```tsx
import { motion } from "framer-motion";
import { CHANGELOG, PR_URL } from "../../data/changelog";

/** Classic-résumé patch notes (spec §8.4): the same entries as the in-game panel, newest first. */
export default function Changelog() {
  return (
    <section id="changelog" className="py-24 relative w-full">
      <div className="max-w-4xl mx-auto px-6 w-full">
        <div className="mb-14 text-center md:text-left">
          <p className="font-mono text-xs text-primary tracking-widest uppercase mb-2">// PATCH_NOTES</p>
          <h2 className="font-display font-black text-3xl sm:text-4xl lg:text-5xl">Changelog</h2>
          <p className="text-muted text-sm font-light mt-3 max-w-2xl">
            What shipped on this flight-sim portfolio, and why. Newest first.
          </p>
        </div>
        <ol className="relative border-l border-white/10 ml-2">
          {CHANGELOG.map((e, i) => (
            <motion.li key={e.id} data-testid="resume-changelog-entry"
              initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.4, delay: Math.min(i, 6) * 0.04 }}
              className="mb-10 ml-6 last:mb-0">
              <span className="absolute -left-[7px] mt-1.5 w-3.5 h-3.5 rounded-full border-2 border-white/30 bg-[#020108]" aria-hidden="true" />
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
                <h3 className="font-display font-bold text-lg text-white">{e.title}</h3>
                <span className="font-mono text-xs text-muted">
                  {e.date} · <a href={`${PR_URL}${e.pr}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">PR #{e.pr}</a>
                </span>
              </div>
              <dl className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1.5 text-sm font-light leading-relaxed max-w-2xl">
                <dt className="font-mono text-xs text-white/40 pt-0.5">WHAT</dt><dd className="text-white/80">{e.what}</dd>
                <dt className="font-mono text-xs text-white/40 pt-0.5">WHY</dt><dd className="text-muted">{e.why}</dd>
                <dt className="font-mono text-xs text-white/40 pt-0.5">HOW</dt><dd className="text-muted">{e.how}</dd>
              </dl>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}
```

(WHEN sits in the header line beside the title, as on the Career timeline.)

- [ ] **Step 2: Mount it and link it**

`src/App.tsx`, in the résumé `<main>`, between `<Skills />` and `<Contact />`:

```tsx
            <Skills />
            <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            <Changelog />
            <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            <Contact />
```

(import `Changelog from "./components/sections/Changelog"`). In `src/components/layout/Navbar.tsx`, add `{ name: "Changelog", href: "#changelog" },` after the Skills link.

- [ ] **Step 3: e2e**

Append to `tests/e2e/logbook.probe.mjs`, before `export default`:

```js
async function changelog(page, checks) {
  const n = await page.evaluate(async () => (await import("/src/data/changelog.ts")).CHANGELOG.length);
  // A returning visitor who last saw an older entry gets the dot.
  await page.evaluate(() => localStorage.setItem("fitz-changelog-seen", JSON.stringify("2026-10-10-first-minute-fixes")));
  await page.reload();
  await page.waitForFunction(() => window.__fitz?.store.getState().sceneReady, { timeout: 60_000 });
  checks.check("a returning visitor sees the new-updates dot", !!(await page.$('[data-testid="changelog-dot"]')));
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("KeyN");
  await settle(page, 400);
  const st = await page.evaluate(() => ({
    focus: document.activeElement?.id,
    entries: document.querySelectorAll('[data-testid="changelog-entry"]').length,
    labels: [...document.querySelectorAll('[data-testid="changelog-panel"] dt')].slice(0, 4).map((d) => d.textContent),
  }));
  checks.check("N opens the patch notes with focus on the heading", st.focus === "changelog-title", `focus=${st.focus}`);
  checks.check("every entry is listed", st.entries === n, `${st.entries}/${n}`);
  checks.check("each entry answers what, why, when and how", JSON.stringify(st.labels) === JSON.stringify(["WHAT", "WHY", "WHEN", "HOW"]), JSON.stringify(st.labels));
  checks.check("opening the notes clears the dot", !(await page.$('[data-testid="changelog-dot"]')));
  await page.keyboard.press("KeyL");
  await settle(page, 300);
  const both = await readStore(page);
  checks.check("opening the logbook closes the patch notes", both.logbookOpen && !both.changelogOpen);
  await page.keyboard.press("Escape");
  // First visit: no dot.
  await page.evaluate(() => localStorage.removeItem("fitz-changelog-seen"));
  await page.reload();
  await page.waitForFunction(() => window.__fitz?.store.getState().sceneReady, { timeout: 60_000 });
  checks.check("a first-time visitor sees no dot", !(await page.$('[data-testid="changelog-dot"]')));
  // Résumé section.
  await page.evaluate(() => window.__fitz.store.getState().setShowClassicCV(true));
  await settle(page, 800);
  const resume = await page.evaluate(() => document.querySelectorAll('#changelog [data-testid="resume-changelog-entry"]').length);
  checks.check("the résumé lists every changelog entry", resume === n, `${resume}/${n}`);
}
```

and in `run()` add:

```js
  const c = await withPage({ label: "changelog" }, changelog);
  checks.results.push(...c.results);
```

Also extend the `phone` function: after the logbook geometry checks, close the logbook, open the changelog with `setChangelogOpen(true)`, and assert the same bottom-sheet and no-cover checks for `changelog-panel`.

- [ ] **Step 4: Run and commit**

Close app tabs. Run: `npm run test:e2e -- logbook`
Expected: all checks pass.

```bash
git add src/components/sections/Changelog.tsx src/App.tsx src/components/layout/Navbar.tsx tests/e2e/logbook.probe.mjs
git commit -m "feat(changelog): résumé changelog section and navbar link; e2e for patch notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Verification bar and real-browser pass

- [ ] **Step 1:** `npm test && npx tsc -b && npm run lint`. Green, lint unchanged.
- [ ] **Step 2:** Close app tabs, then `npm run test:e2e`. Every check passes.
- [ ] **Step 3:** `npm run build`, then `grep -l "__fitz" dist/assets/*.js`. It prints nothing.
- [ ] **Step 4: Real-browser pass (Playwright MCP, dev server on a free port).** Also open the patch notes in-game and on the résumé, desktop and phone.
  - Earn slingshot, comet and ore naturally in flight, without store calls.
  - Screenshot the tracker, the open panel, and the ship with each unlocked plume. Do this on desktop (1440×900) and phone (390×844, touch).
  - Confirm each colour reads clearly under bloom. If one washes out, retune it in `plumeColors.ts` and ledger the change.
- [ ] **Step 5:** Report the results to the controller. Do not push.
