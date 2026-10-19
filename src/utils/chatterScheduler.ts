export interface ChatterPools {
  deepSpace: string[];
  zones: Record<string, string[]>;
  warp: string[];
  /** Entering the edge haze (EdgeHaze). */
  haze: string[];
  /** Leaving a planet's well fast (Spaceship). */
  slingshot: string[];
  /** First ore of a session (AsteroidBelt). */
  ore: string[];
  comet: string[];
  impact: string[];
  /** Cargo ships hailing a pilot who flies close (CargoTraffic). */
  hail: string[];
}

export type ChatterKind = "ambient" | "zone" | "warp" | "haze" | "slingshot" | "ore" | "comet" | "impact" | "hail";

/** Pure line-selection + pacing logic. Injectable RNG for tests. */
export class ChatterScheduler {
  private lastLine: string | null = null;
  private pools: ChatterPools;
  private random: () => number;

  constructor(pools: ChatterPools, random: () => number = Math.random) {
    this.pools = pools;
    this.random = random;
  }

  pick(kind: ChatterKind, zone?: string | null): string {
    let pool: string[];
    if (kind === "zone" && zone && this.pools.zones[zone]) pool = this.pools.zones[zone];
    else if (kind === "warp") pool = this.pools.warp;
    else if (kind === "haze") pool = this.pools.haze;
    else if (kind === "slingshot") pool = this.pools.slingshot;
    else if (kind === "ore") pool = this.pools.ore;
    else if (kind === "comet") pool = this.pools.comet;
    else if (kind === "impact") pool = this.pools.impact;
    else if (kind === "hail") pool = this.pools.hail;
    else pool = this.pools.deepSpace;

    const candidates = pool.length > 1 ? pool.filter((l) => l !== this.lastLine) : pool;
    const line = candidates[Math.floor(this.random() * candidates.length)];
    this.lastLine = line;
    return line;
  }

  nextDelayMs(): number {
    return 18000 + Math.floor(this.random() * 17000);
  }
}

/**
 * The zone pool a radio line draws from: a destination's zone (`activeZone`)
 * wins, then the probe in range (`probeNear`), else none. Planets have no
 * zone (project probes, spec §4.4).
 */
export function chatterZone(activeZone: string | null, probeNear: string | null): string | null {
  return activeZone ?? probeNear;
}
