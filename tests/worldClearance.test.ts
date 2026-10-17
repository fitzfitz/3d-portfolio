import { describe, it, expect } from "vitest";
import { WORLDS } from "../src/data/worlds";
import { closestApproach } from "./helpers/clearance";
import { worldMargins, worldReach, type ToOrbit } from "./helpers/worldRules";

/**
 * Placement is a permanent test (spec "Built to scale", rule 3): every world's
 * swept orbit (SAMPLES points) clears every planet and world, both comet paths,
 * the jelly path, the sun, the belt, the halo, every shard, scenery asteroid,
 * ring gate, landmark and the spawn, and keeps its body out of the edge haze.
 * The rules live in helpers/worldRules.ts, shared with the search tool.
 */
const sweep: ToOrbit = (orbit, p) => closestApproach({ orbit }, p);

describe("world clearance along the full orbit", () => {
  it.each(WORLDS.map((w) => [w.id, w] as const))("%s clears everything placed", (_, w) => {
    const others = WORLDS.filter((o) => o !== w).map((o) => ({ name: o.id, reach: worldReach(o), orbit: o.orbit }));
    for (const m of worldMargins(w, others, sweep)) expect(m.margin, `${w.id} vs ${m.what}`).toBeGreaterThan(0);
  });
});
