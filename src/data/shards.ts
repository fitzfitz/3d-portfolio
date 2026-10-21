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
  // Beside the spawn pad (SPAWN, src/data/spawn.ts), ~11 units out: the easy first find
  { pos: [-42, 64, 77], fact: "WELCOME, PILOT. THIS PORTFOLIO IS ALSO A FLIGHT SIM. NO REFUNDS" },
  // Below the plane, clear of the real orbits' wells (tests/solarClearance.test.ts)
  { pos: [53, -43, 50], fact: "RUANGRAPI TRACKS EVERY KOS ROOM'S RENT. THE PILOT TRACKS EVERY SHARD. SAME ENERGY" },
  // High above the sun (fact says so)
  { pos: [0, 140, 0], fact: "FROM UP HERE THE WHOLE SOLAR SYSTEM IS ONE REACT TREE. THE PILOT FINDS THIS CALMING" },
  // High cluster, near the second planet's upper orbital reach
  { pos: [-95, 120, 60], fact: "ALL TEN SHARDS ARE ONE INSTANCED MESH. ONE DRAW CALL, TEN SECRETS" },
  // Deep below (fact says so)
  { pos: [6, -140, -10], fact: "DOWN HERE IT'S DARK, COLD, AND FULL OF UNIT TESTS" },
  // Deep cluster, far side
  { pos: [-110, -135, -90], fact: "3 AI CODE REVIEWERS APPROVED THIS UNIVERSE. A FOURTH IS STILL THINKING" },
  // Near the sun: above the plane, outside its 24-unit core and clear of Mercury's real orbit well
  { pos: [-22, 32, -28], fact: "FUXX RUNS A FLEET OF AI CODING AGENTS IN ONE TERMINAL. THE PILOT RUNS ONE SPACESHIP. FOR NOW" },
  // Beside the portal — reward for the climb
  { pos: [10, 98, -140], fact: "ASTEROIDS DO NOT HAVE STANDUPS. THE PILOT ENVIES THIS" },
  // Far corner, high
  { pos: [190, 90, -160], fact: "YOU HAVE TRAVELED FAR FOR A JPEG OF A RESUME. RESPECT" },
  // Second near-spawn shard. Often the second one found, so its fact must not
  // claim completion — that message lives in SHARDS_COMPLETE_MESSAGE.
  { pos: [-58, 60, 62], fact: "TWO SHARDS THIS CLOSE TO SPAWN. THE PILOT CALLS THAT ONBOARDING" },
];

/** Prefixes a fact with the visitor's running count, e.g. "DATA_SHARD 2/10 // …". */
export function shardBroadcast(fact: string, collectedCount: number, total = SHARDS.length): string {
  return `DATA_SHARD ${collectedCount}/${total} // ${fact}`;
}

export const SHARDS_COMPLETE_MESSAGE =
  "ALL SHARDS RECOVERED // THE PILOT IS IMPRESSED AND SLIGHTLY CONCERNED ABOUT YOUR FREE TIME. PRESS P FOR A VICTORY PHOTO";
