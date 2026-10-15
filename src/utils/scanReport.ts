import { beaconRegistry, beaconReport } from "./beacons";
import { ghostRegistry, ghostReport } from "./liveSky";
import { BUOYS } from "../data/careerTrail";

/** One report per career buoy: the posting it marks, from src/data/career.ts. */
const BUOY_REPORTS = new Map(BUOYS.map((b) => [b.id,
  `SCAN[${b.label}] // ${b.entry.role} · ${b.entry.company} · ${b.entry.start} – ${b.entry.end ?? "Present"} // ${b.entry.summary}`.toUpperCase()]));

const PLANET_REPORTS: Record<string, string> = {
  ruangrapi: "SCAN[PLANET_RUANGRAPI] // CORE: SUPABASE+POSTGRES · CRUST: REACT+TYPESCRIPT · SHIELD: ROW-LEVEL SECURITY // INHABITANTS: KOS LANDLORDS",
  portfolio: "SCAN[PLANET_PORTFOLIO] // CORE: THREE.JS · ATMOSPHERE: REACT THREE FIBER · MOONS: BLENDER-SCRIPTED GLBS // ORBITING IT: YOU",
  fuxx: "SCAN[PLANET_FUXX] // CORE: RUST · SURFACE: GPUI, GPU-RENDERED · POPULATION: PARALLEL AI CODING AGENTS",
  contact: "SCAN[PORTAL_SUN] // COMM-GATE RESONANT. THE PILOT ANSWERS TRANSMISSIONS. DOCK TO COMPOSE",
  career: "SCAN[STATION_CAREER] // HABITAT RING SPINNING. THE PILOT'S WORK HISTORY IS ON FILE. DOCK TO READ IT",
  time_trial: "SCAN[TIME_TRIAL_GATE] // A LOOP OF RINGS THROUGH THE BELT AND BACK. FLY THROUGH TO START THE CLOCK. WARP WISELY: ONE TANK WON'T COVER IT",
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

export function generateScanReport(id: string): string {
  if (ghostRegistry.has(id)) return ghostReport(ghostRegistry.get(id) ?? null);
  const beacon = beaconRegistry.get(id);
  if (beacon) return beaconReport(beacon, Date.now());
  const buoy = BUOY_REPORTS.get(id);
  if (buoy) return buoy;
  const table = PLANET_REPORTS[id];
  if (table) return table;
  const h = hash(id);
  const e1 = ELEMENTS[h % ELEMENTS.length];
  const e2 = ELEMENTS[(h >> 3) % ELEMENTS.length];
  const p1 = 20 + (h % 45);
  const p2 = 5 + ((h >> 5) % 30);
  const quip = QUIPS[(h >> 8) % QUIPS.length];
  return `SCAN[${id.toUpperCase()}] // ${e1} ${p1}% · ${e2} ${p2}% · UNKNOWN ${100 - p1 - p2}% // ${quip}`;
}
