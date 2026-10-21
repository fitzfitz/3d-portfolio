import { beaconRegistry, beaconReport } from "./beacons";
import { ghostRegistry, ghostReport } from "./liveSky";
import { BUOYS } from "../data/careerTrail";
import { isBodyId } from "../data/bodyIds";
import { bodyById } from "../data/solarSystem";
import { bodyReport } from "./bodyReports";
import { COMET_ELEMENTS, COMET_LABELS, COMET_SCAN_IDS } from "../data/smallBodyField";

/** One real-orbit report per comet: semi-major axis, eccentricity and period from its SBDB elements. */
const COMET_REPORTS = new Map(COMET_SCAN_IDS.map((id, i) => {
  const el = COMET_ELEMENTS[i];
  const periodYears = 360 / el.nDegPerDay / 365.25;
  return [id,
    `SCAN[${COMET_LABELS[i]}] // PERIODIC COMET // A ${el.a.toFixed(2)} AU · E ${el.e.toFixed(2)} · PERIOD ${periodYears.toFixed(1)} YR // ICE AND DUST ON A REAL ORBIT, TAILS GROW NEAR THE SUN`];
}));

/** One report per career buoy: the posting it marks, from src/data/career.ts. */
const BUOY_REPORTS = new Map(BUOYS.map((b) => [b.id,
  `SCAN[${b.label}] // ${b.entry.role} · ${b.entry.company} · ${b.entry.start} – ${b.entry.end ?? "Present"} // ${b.entry.summary}`.toUpperCase()]));

const FIXED_REPORTS: Record<string, string> = {
  contact: "SCAN[PORTAL_SUN] // COMM-GATE RESONANT. THE PILOT ANSWERS TRANSMISSIONS. DOCK TO COMPOSE",
  career: "SCAN[STATION_CAREER] // HABITAT RING SPINNING. THE PILOT'S WORK HISTORY IS ON FILE. DOCK TO READ IT",
  shipyard: "SCAN[DRYDOCK_01] // CRANE RUNNING. ENGINE PLUMES ARE REFITTED HERE. DOCK TO OPEN THE HANGAR",
  dormant_gate: "SCAN[UNKNOWN_STRUCTURE] // ORIGIN UNKNOWN // DORMANT // NO RESPONSE TO HAIL",
  time_trial: "SCAN[TIME_TRIAL_GATE] // A LOOP OF RINGS THROUGH THE INNER SYSTEM, ABOVE AND BELOW THE ORBITS OF MERCURY, VENUS AND EARTH. FLY THROUGH TO START THE CLOCK. PAR 35 S",
};

const ELEMENTS = ["FE", "NI", "SI", "MG", "H2O-ICE", "IR", "AU", "CAFFEINE"];
const QUIPS = [
  "MASS CLASS: C — MOSTLY HARMLESS",
  "MASS CLASS: B — DO NOT LICK",
  "MASS CLASS: D — SENTIMENTAL VALUE ONLY",
  "MASS CLASS: A — INSURANCE RECOMMENDED",
];

function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * The report for scannable `id`. A body's numbers are live (its distance from
 * the Sun), so it takes the ambient clock's `gameSeconds`.
 */
export function generateScanReport(id: string, gameSeconds = 0): string {
  const ghost = ghostRegistry.get(id);
  if (ghost) return ghostReport(ghost.cc, ghost.ch);
  const beacon = beaconRegistry.get(id);
  if (beacon) return beaconReport(beacon, Date.now());
  const comet = COMET_REPORTS.get(id);
  if (comet) return comet;
  const buoy = BUOY_REPORTS.get(id);
  if (buoy) return buoy;
  if (isBodyId(id)) return bodyReport(bodyById(id), gameSeconds);
  const fixed = FIXED_REPORTS[id];
  if (fixed) return fixed;
  const h = hash(id);
  const e1 = ELEMENTS[h % ELEMENTS.length];
  const e2 = ELEMENTS[(h >>> 3) % ELEMENTS.length];
  const p1 = 20 + (h % 45);
  const p2 = 5 + ((h >>> 5) % 30);
  const quip = QUIPS[(h >>> 8) % QUIPS.length];
  return `SCAN[${id.toUpperCase()}] // ${e1} ${p1}% · ${e2} ${p2}% · UNKNOWN ${100 - p1 - p2}% // ${quip}`;
}
