export interface Shard {
  pos: [number, number, number];
  fact: string;
}

/** Collectible data shards scattered across the system. 10 total. */
export const SHARDS: Shard[] = [
  // Near spawn — easy first find
  { pos: [8, 1, 22], fact: "DATA_SHARD 1/10 // WELCOME, PILOT. THIS PORTFOLIO IS ALSO A FLIGHT SIM. NO REFUNDS" },
  // On the saas orbit ring, ahead of the planet's start position
  { pos: [80, -28, 75], fact: "DATA_SHARD 2/10 // THE PILOT SHIPS SCHEMA-ISOLATED TENANTS BEFORE BREAKFAST — 15,000 SUBSCRIPTIONS, ZERO CROSS-TALK" },
  // High above the sun (fact says so)
  { pos: [0, 140, 0], fact: "DATA_SHARD 3/10 // STRIPE CONNECT SPLITS FEES IN REAL TIME. THE PILOT SPLITS ATOMS. KIDDING. MOSTLY" },
  // High cluster, near the video orbit's upper reach
  { pos: [-95, 120, 60], fact: "DATA_SHARD 4/10 // WHISPER TRANSCRIBES EVERY FRAME. THE AI VIRAL-VIDEO PIPELINE NEVER SLEEPS, NEVER COMPLAINS" },
  // Deep below (fact says so)
  { pos: [6, -140, -10], fact: "DATA_SHARD 5/10 // DOWN HERE IT'S DARK, COLD, AND FULL OF UNIT TESTS" },
  // Deep cluster, far side
  { pos: [-110, -135, -90], fact: "DATA_SHARD 6/10 // 3 AI CODE REVIEWERS APPROVED THIS UNIVERSE. A FOURTH IS STILL THINKING" },
  // Near the sun
  { pos: [4, 4, 8], fact: "DATA_SHARD 7/10 // THE MULTI-AGENT TDD FRAMEWORK WRITES THE FAILING TEST FIRST. SO DOES THIS SENTENCE" },
  // Beside the portal — reward for the climb
  { pos: [10, 98, -140], fact: "DATA_SHARD 8/10 // ASTEROIDS DO NOT HAVE STANDUPS. THE PILOT ENVIES THIS" },
  // Far corner, high
  { pos: [190, 90, -160], fact: "DATA_SHARD 9/10 // YOU HAVE TRAVELED FAR FOR A JPEG OF A RESUME. RESPECT" },
  // Final shard — near spawn, hints at completion
  { pos: [-8, 1, 20], fact: "DATA_SHARD 10/10 // ALL SHARDS FOUND. THE PILOT IS IMPRESSED AND SLIGHTLY CONCERNED ABOUT YOUR FREE TIME" },
];
