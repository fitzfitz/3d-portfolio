export interface Shard {
  pos: [number, number, number];
  fact: string;
}

/**
 * Collectible data shards scattered across the system. 10 total.
 *
 * Facts carry no "n/10" prefix: shardBroadcast() numbers each pickup by how
 * many have been collected, since visitors find them in any order.
 */
export const SHARDS: Shard[] = [
  // Near spawn — easy first find
  { pos: [8, 1, 22], fact: "WELCOME, PILOT. THIS PORTFOLIO IS ALSO A FLIGHT SIM. NO REFUNDS" },
  // On the saas orbit ring, ahead of the planet's start position
  { pos: [80, -28, 75], fact: "THE PILOT SHIPS SCHEMA-ISOLATED TENANTS BEFORE BREAKFAST — 15,000 SUBSCRIPTIONS, ZERO CROSS-TALK" },
  // High above the sun (fact says so)
  { pos: [0, 140, 0], fact: "STRIPE CONNECT SPLITS FEES IN REAL TIME. THE PILOT SPLITS ATOMS. KIDDING. MOSTLY" },
  // High cluster, near the video orbit's upper reach
  { pos: [-95, 120, 60], fact: "WHISPER TRANSCRIBES EVERY FRAME. THE AI VIRAL-VIDEO PIPELINE NEVER SLEEPS, NEVER COMPLAINS" },
  // Deep below (fact says so)
  { pos: [6, -140, -10], fact: "DOWN HERE IT'S DARK, COLD, AND FULL OF UNIT TESTS" },
  // Deep cluster, far side
  { pos: [-110, -135, -90], fact: "3 AI CODE REVIEWERS APPROVED THIS UNIVERSE. A FOURTH IS STILL THINKING" },
  // Near the sun
  { pos: [4, 4, 8], fact: "THE MULTI-AGENT TDD FRAMEWORK WRITES THE FAILING TEST FIRST. SO DOES THIS SENTENCE" },
  // Beside the portal — reward for the climb
  { pos: [10, 98, -140], fact: "ASTEROIDS DO NOT HAVE STANDUPS. THE PILOT ENVIES THIS" },
  // Far corner, high
  { pos: [190, 90, -160], fact: "YOU HAVE TRAVELED FAR FOR A JPEG OF A RESUME. RESPECT" },
  // Second near-spawn shard. Often the second one found, so its fact must not
  // claim completion — that message lives in SHARDS_COMPLETE_MESSAGE.
  { pos: [-8, 1, 20], fact: "TWO SHARDS THIS CLOSE TO SPAWN. THE PILOT CALLS THAT ONBOARDING" },
];

/** Prefixes a fact with the visitor's running count, e.g. "DATA_SHARD 2/10 // …". */
export function shardBroadcast(fact: string, collectedCount: number, total = SHARDS.length): string {
  return `DATA_SHARD ${collectedCount}/${total} // ${fact}`;
}

export const SHARDS_COMPLETE_MESSAGE =
  "ALL SHARDS RECOVERED // THE PILOT IS IMPRESSED AND SLIGHTLY CONCERNED ABOUT YOUR FREE TIME. PRESS P FOR A VICTORY PHOTO";
