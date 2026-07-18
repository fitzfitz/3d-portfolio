export interface Shard {
  pos: [number, number, number];
  fact: string;
}

/** Collectible data shards scattered across the system. 10 total. */
export const SHARDS: Shard[] = [
  // Near spawn — easy first find
  { pos: [8, 1, 22], fact: "DATA_SHARD 1/10 // WELCOME, PILOT. THIS PORTFOLIO IS ALSO A FLIGHT SIM. NO REFUNDS" },
  // Near the SaaS planet
  { pos: [34, 2, -18], fact: "DATA_SHARD 2/10 // THE PILOT SHIPS SCHEMA-ISOLATED TENANTS BEFORE BREAKFAST — 15,000 SUBSCRIPTIONS, ZERO CROSS-TALK" },
  // High above the sun
  { pos: [0, 32, 0], fact: "DATA_SHARD 3/10 // STRIPE CONNECT SPLITS FEES IN REAL TIME. THE PILOT SPLITS ATOMS. KIDDING. MOSTLY" },
  // Near the video planet
  { pos: [-30, -3, 26], fact: "DATA_SHARD 4/10 // WHISPER TRANSCRIBES EVERY FRAME. THE AI VIRAL-VIDEO PIPELINE NEVER SLEEPS, NEVER COMPLAINS" },
  // Deep below
  { pos: [6, -34, -10], fact: "DATA_SHARD 5/10 // DOWN HERE IT'S DARK, COLD, AND FULL OF UNIT TESTS" },
  // Near the agent planet
  { pos: [-36, 3, -30], fact: "DATA_SHARD 6/10 // 3 AI CODE REVIEWERS APPROVED THIS UNIVERSE. A FOURTH IS STILL THINKING" },
  // Near the sun
  { pos: [4, 4, 8], fact: "DATA_SHARD 7/10 // THE MULTI-AGENT TDD FRAMEWORK WRITES THE FAILING TEST FIRST. SO DOES THIS SENTENCE" },
  // Mid-belt gap
  { pos: [-60, 26, 40], fact: "DATA_SHARD 8/10 // ASTEROIDS DO NOT HAVE STANDUPS. THE PILOT ENVIES THIS" },
  // Far corner
  { pos: [190, -6, -160], fact: "DATA_SHARD 9/10 // YOU HAVE TRAVELED FAR FOR A JPEG OF A RESUME. RESPECT" },
  // Final shard — near spawn, hints at completion
  { pos: [-8, 1, 20], fact: "DATA_SHARD 10/10 // ALL SHARDS FOUND. THE PILOT IS IMPRESSED AND SLIGHTLY CONCERNED ABOUT YOUR FREE TIME" },
];
