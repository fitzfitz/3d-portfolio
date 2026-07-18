const PLANET_REPORTS: Record<string, string> = {
  saas: "SCAN[PLANET_SAAS] // CORE: 15,000 ACTIVE SUBSCRIPTIONS · CRUST: TYPESCRIPT+HONO · RINGS: STRIPE CONNECT // STABILITY: SUB-MILLISECOND",
  video: "SCAN[PLANET_VIDEO] // ATMOSPHERE: WHISPER TRANSCRIPTS · SURFACE: SEMANTIC SCENES · EXPORTS: VERTICAL, HIGH-RETENTION",
  agent: "SCAN[PLANET_AGENT] // POPULATION: CODER+REVIEW AGENTS · GOVERNMENT: HIERARCHY MANAGERS · LAW: LOCAL TDD CYCLES",
  contact: "SCAN[PORTAL_SUN] // COMM-GATE RESONANT. THE PILOT ANSWERS TRANSMISSIONS. DOCK TO COMPOSE",
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
