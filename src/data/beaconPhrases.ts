/**
 * Everything a visitor's beacon can say. A beacon stores an index into this
 * list, never text: there is nothing to moderate, and the beacon API rejects
 * any index outside it. Shared by the client and beacon-api/.
 *
 * APPEND ONLY. Stored beacons reference these by position, so reordering or
 * deleting a line silently changes what old beacons say.
 */
export const BEACON_PHRASES = [
  "HELLO FROM ORBIT",
  "NICE VIEW",
  "TRY WARP HERE",
  "SHARD NEARBY",
  "WATCH FOR ROCKS",
  "THE JELLYFISH WAS HERE",
  "BEAT PAR. YOUR MOVE",
  "LOST. SEND COFFEE",
  "HIRE THIS PILOT",
] as const;
