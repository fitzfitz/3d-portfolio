import { describe, it, expect } from "vitest";
import {
  createWaypointTarget, placeTarget, recruiterTarget, makeGuideTarget, type WaypointTarget,
} from "../src/utils/waypointTarget";
import { recruiterWaypoint } from "../src/utils/recruiterWaypoint";
import { probePos } from "../src/store/probeState";
import { PROBE_IDS, PROBE_IN_RANGE } from "../src/data/probes";
import { destinationById } from "../src/data/destinations";
import { SOLAR_BODIES } from "../src/data/solarSystem";
import { BODY_IDS, type BodyId } from "../src/data/bodyIds";
import { SCAN_RANGE } from "../src/utils/scannables";
import { LOGBOOK, isRecordable, SHARDS_FOR_BADGE, type LogbookProgress, type BadgeRecord } from "../src/utils/logbook";
import type { ChartRecord } from "../src/utils/charting";

type V = { x: number; y: number; z: number };
const ship: V = { x: 0, y: 0, z: 0 };
const badge = (id: string): BadgeRecord => ({ id, at: "2026-10-23" });
const chart = (id: BodyId): ChartRecord => ({ id, at: "2026-10-23" });
/** Bodies laid out on +x so "nearest" is unambiguous: mercury at 1000, venus at 2000, ... */
const bodies = Object.fromEntries(BODY_IDS.map((id, i) => [id, { x: 1000 * (i + 1), y: 0, z: 0 }])) as Record<BodyId, V>;
const size = (id: BodyId) => SOLAR_BODIES.find((b) => b.id === id)!.size;

const ESSENTIALS: LogbookProgress = {
  visitedDossiers: [...PROBE_IDS], shardsCollected: [], badges: [badge("career"), badge("contact")],
};
const EVERYTHING: LogbookProgress = {
  visitedDossiers: [...PROBE_IDS],
  shardsCollected: Array.from({ length: SHARDS_FOR_BADGE }, (_, i) => i),
  badges: LOGBOOK.filter((e) => isRecordable(e.id)).map((e) => badge(e.id)),
};

function at(t: WaypointTarget): V { return { x: t.x, y: t.y, z: t.z }; }

describe("placeTarget (a waypoint id to a world position and an arrival radius)", () => {
  it("a probe sits at its live spot; arrival is the HUD's PROBE_IN_RANGE (its TARGET line locks there)", () => {
    const out = createWaypointTarget();
    const id = PROBE_IDS[0];
    expect(placeTarget(id, out)).toBe(true);
    expect(at(out)).toEqual(probePos[id]);
    expect(out.radius).toBe(PROBE_IN_RANGE);
  });
  it("a destination sits at its table position; arrival is its zone radius (the HUD target)", () => {
    const out = createWaypointTarget();
    for (const id of ["career", "contact"]) {
      const d = destinationById(id)!;
      expect(placeTarget(id, out)).toBe(true);
      expect(at(out)).toEqual({ x: d.pos[0], y: d.pos[1], z: d.pos[2] });
      expect(out.radius).toBe(d.zoneR);
    }
  });
  it("an unknown id has no position", () => {
    expect(placeTarget("nowhere", createWaypointTarget())).toBe(false);
  });
  it("follows a probe that moved (reads the live spot, never a copy)", () => {
    const id = PROBE_IDS[1], p = probePos[id], saved = { ...p };
    p.x += 123;
    const out = createWaypointTarget();
    placeTarget(id, out);
    expect(out.x).toBe(saved.x + 123);
    Object.assign(p, saved);
  });
});

describe("recruiterTarget (WaypointDriver: the HUD waypoint)", () => {
  it("is recruiterWaypoint's id at placeTarget's position", () => {
    const cases: [readonly string[], BadgeRecord[]][] = [
      [[], []], [PROBE_IDS.slice(0, 2), []], [[...PROBE_IDS], []], [[...PROBE_IDS], [badge("career")]],
      [[...PROBE_IDS], [badge("career"), badge("contact")]],
    ];
    for (const [visited, badges] of cases) {
      const out = createWaypointTarget(), want = createWaypointTarget();
      const id = recruiterWaypoint(ship, visited, badges);
      expect(recruiterTarget(ship, visited, badges, out)).toBe(placeTarget(id, want));
      expect(out).toEqual({ ...want, id });
    }
  });
  it("writes the id even when it has no position", () => {
    const out = createWaypointTarget();
    out.id = "stale";
    recruiterTarget(ship, [], [], out);
    expect(out.id).toBe(recruiterWaypoint(ship, [], []));
  });
});

describe("makeGuideTarget (controller ruling R1: the guide's target)", () => {
  it("before the essentials are done it is the HUD waypoint, exactly", () => {
    const guide = makeGuideTarget();
    const steps: LogbookProgress[] = [
      { visitedDossiers: [], shardsCollected: [], badges: [] },
      { visitedDossiers: [...PROBE_IDS], shardsCollected: [], badges: [] },
      { visitedDossiers: [...PROBE_IDS], shardsCollected: [], badges: [badge("career")] },
    ];
    for (const p of steps) {
      const out = createWaypointTarget(), hud = createWaypointTarget();
      expect(guide(ship, p, [], bodies, out)).toBe(true);
      recruiterTarget(ship, p.visitedDossiers, p.badges, hud);
      expect(out).toEqual(hud);
    }
  });
  it("once the essentials are done it is the nearest uncharted body, at its scan radius", () => {
    const out = createWaypointTarget();
    expect(makeGuideTarget()(ship, ESSENTIALS, [], bodies, out)).toBe(true);
    expect(out.id).toBe("mercury");
    expect(at(out)).toEqual(bodies.mercury);
    // Scanning measures from the surface (scannables.ts), so a body's reach is its size plus SCAN_RANGE.
    expect(out.radius).toBe(size("mercury") + SCAN_RANGE);
  });
  it("skips charted bodies (CARTOGRAPHER: charted counts as visited)", () => {
    const out = createWaypointTarget();
    makeGuideTarget()(ship, ESSENTIALS, [chart("mercury"), chart("venus")], bodies, out);
    expect(out.id).toBe("earth");
    expect(out.radius).toBe(size("earth") + SCAN_RANGE);
  });
  it("is nearest to the ship, not first in the table", () => {
    const out = createWaypointTarget();
    makeGuideTarget()({ x: 5100, y: 0, z: 0 }, ESSENTIALS, [], bodies, out);
    expect(out.id).toBe(BODY_IDS[4]);
  });
  it("never a badge entry: the open badges do not change the target", () => {
    const a = createWaypointTarget(), b = createWaypointTarget();
    makeGuideTarget()(ship, ESSENTIALS, [], bodies, a);
    makeGuideTarget()(ship, { ...ESSENTIALS, badges: [...ESSENTIALS.badges, badge("slingshot"), badge("comet")] }, [], bodies, b);
    expect(a).toEqual(b);
    expect(BODY_IDS as readonly string[]).toContain(a.id);
  });
  it("is null once every body is charted", () => {
    expect(makeGuideTarget()(ship, ESSENTIALS, BODY_IDS.map(chart), bodies, createWaypointTarget())).toBe(false);
  });
  it("is null when the logbook has no next goal, even with worlds left to chart", () => {
    expect(makeGuideTarget()(ship, EVERYTHING, [], bodies, createWaypointTarget())).toBe(false);
  });
  it("follows new progress through the same memo (new arrays, as the store makes them)", () => {
    const guide = makeGuideTarget(), out = createWaypointTarget();
    let p: LogbookProgress = { visitedDossiers: [...PROBE_IDS], shardsCollected: [], badges: [badge("career")] };
    guide(ship, p, [], bodies, out);
    expect(out.id).toBe("contact");
    p = { ...p, badges: [...p.badges, badge("contact")] };
    guide(ship, p, [], bodies, out);
    expect(out.id).toBe("mercury");
    guide(ship, p, [chart("mercury")], bodies, out);
    expect(out.id).toBe("venus");
    expect(guide(ship, p, BODY_IDS.map(chart), bodies, out)).toBe(false);
  });
});
