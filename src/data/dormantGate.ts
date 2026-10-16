import type { Vec3 } from "./careerTrail";

/**
 * The dormant gate (docs/superpowers/specs/2026-10-16-shipyard-gate-design.md §1–2):
 * a broken hexagonal arch far out in the system. It is found by flying, never
 * by a jump key or a waypoint, and names itself only to the scanner. What
 * wakes it is the secret-sector project's to decide.
 */
export const GATE_POS: Vec3 = [-150, 130, 90];
/** Model bounding radius (tests/assetContracts.test.ts holds the GLB to it). */
export const GATE_RADIUS = 15;
/** A pass counts within this distance of the axis: the opening's inner apothem is 10.5. */
export const GATE_OPENING_R = 10;
/** Inside this distance the seams flicker and the first radio line plays. */
export const GATE_SENSE_R = 60;
/** Placement and crystal keep-out around the centre: the frame plus room. */
export const GATE_KEEP_OUT = 20;

const LEN = Math.hypot(GATE_POS[0], GATE_POS[1], GATE_POS[2]);
/** The opening's axis, toward the sun. DormantGate turns the model's +Z onto it. */
export const GATE_NORMAL: Vec3 = [-GATE_POS[0] / LEN, -GATE_POS[1] / LEN, -GATE_POS[2] / LEN];

export const GATE_TEAL = "#3de0c8";
/** Radar dot: no name, no colour of its own. */
export const GATE_RADAR_GREY = "#8a8f98";
export const GATE_SCAN_ID = "dormant_gate";
export const GATE_SCAN_LABEL = "UNKNOWN_STRUCTURE";

/** One-time radio lines, once per page load (src/utils/gatePass.ts). */
export const GATE_LINES = {
  approach: "CONTROL // THAT STRUCTURE ISN'T ONE OF OURS. NO RECORD OF IT ANYWHERE.",
  pass: "CONTROL // YOUR READINGS SPIKED THE MOMENT YOU CROSSED. THEN NOTHING.",
} as const;
