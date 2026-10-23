import type { GuideEvent } from "./jellyGuide";

/** The guide's radio pools (chatterLines.ts `guideLines`). */
export interface GuideLines {
  /** A guide the pilot called (J) has reached the ship. */
  called: readonly string[];
  /** It offers itself to a pilot who seems lost. */
  offering: readonly string[];
  /** The pilot reached the step it led to. */
  arrived: readonly string[];
  /** Nothing left to lead to. */
  allDone: readonly string[];
}
type LineKind = keyof GuideLines;

/**
 * A line still waiting for a busy radio after this long (s) is stale and
 * dropped: longer than one broadcast holds the radio (RADIO_BUSY_S, 6 s), so a
 * single scan report or hail delays it rather than eating it.
 */
export const GUIDE_LINE_WAIT_S = 10;

/**
 * The guide's lines on the radio (spec 2026-10-23-jellyfish-guide, "Calling
 * it": "it streaks to the ship (~2 s, glow trail), pulses, and the radio says
 * one line"). Pure, with the clock and the busy flag passed in; allocates
 * nothing per update.
 *
 * Never talks over a busy radio, the way the hails and callouts skip a line
 * while another broadcast is fresh (cargoReaction.ts RADIO_BUSY_S). A guide
 * line is the answer to something the pilot did, so instead of being skipped
 * it waits for the radio to free, up to GUIDE_LINE_WAIT_S. The offer needs no
 * wait: a busy radio already blocks the offer itself (jellyGuide.ts `blocked`).
 */
export class GuideRadio {
  private pending: LineKind | null = null;
  private pendingAt = 0;
  private readonly last: Record<LineKind, number> = { called: -1, offering: -1, arrived: -1, allDone: -1 };

  private readonly lines: GuideLines;
  private readonly random: () => number;

  constructor(lines: GuideLines, random: () => number = Math.random) {
    this.lines = lines;
    this.random = random;
  }

  /**
   * Feed one guide step. `offered`: the run began as an offer (GuideState.offered),
   * whose line went out when it started, so its meeting the ship says nothing more.
   * Returns the line to broadcast now, or null.
   */
  update(event: GuideEvent | null, offered: boolean, now: number, busy: boolean): string | null {
    const kind: LineKind | null =
      event === "met" ? (offered ? null : "called")
      : event === "offered" ? "offering"
      : event === "arrived" ? "arrived"
      : event === "allDone" ? "allDone"
      : null;
    if (kind) { this.pending = kind; this.pendingAt = now; }
    // The guide it was about has gone back to roaming: the line would be wrong.
    else if (event === "dismissed" || event === "declined") this.pending = null;
    if (this.pending === null) return null;
    if (now - this.pendingAt > GUIDE_LINE_WAIT_S) { this.pending = null; return null; }
    if (busy) return null;
    const k = this.pending;
    this.pending = null;
    return this.pick(k);
  }

  /** A line from the pool, never the pool's previous one when it has another. */
  private pick(k: LineKind): string {
    const pool = this.lines[k];
    let i = Math.min(pool.length - 1, Math.floor(this.random() * pool.length));
    if (pool.length > 1 && i === this.last[k]) i = (i + 1) % pool.length;
    this.last[k] = i;
    return pool[i];
  }
}
