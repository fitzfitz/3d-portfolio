export interface ChatterPools {
  deepSpace: string[];
  zones: Record<string, string[]>;
  warp: string[];
  wrap: string[];
  comet: string[];
  altitude: string[];
}

export type ChatterKind = "ambient" | "zone" | "warp" | "wrap" | "comet" | "altitude";

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
    else if (kind === "wrap") pool = this.pools.wrap;
    else if (kind === "comet") pool = this.pools.comet;
    else if (kind === "altitude") pool = this.pools.altitude;
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
