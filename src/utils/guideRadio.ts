import type { GuideEvent } from "./jellyGuide";
import { LOGBOOK } from "./logbook";
import { isBodyId } from "../data/bodyIds";
import { bodyById } from "../data/solarSystem";

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
/** A pool, or "onward", whose line is always built from the next step. */
type LineKind = keyof GuideLines | "onward";

/**
 * The step's own instruction for the arrival line (owner, 2026-10-23: "Will it
 * inform me of what to do?"): the logbook entry's hint for a probe, the career
 * station or the contact portal (their ids are the entries'), the scanner's
 * own hint for an uncharted world (ScanRing: "HOLD E TO SCAN"), or null for
 * anything else, and the radio says the arrived pool's line. Allocates, so it
 * runs on the event, never per frame.
 */
export function arrivalLine(id: string): string | null {
  const e = LOGBOOK.find((x) => x.id === id);
  if (e) return `YOU'RE HERE, PILOT // ${e.hint}`;
  if (isBodyId(id)) return `YOU'RE HERE, PILOT // HOLD E TO SCAN ${bodyById(id).name}`;
  return null;
}

/** The onward line, naming the next step: the entry's short hint, a world to chart, or just the glow. */
export function onwardLine(id: string): string {
  const e = LOGBOOK.find((x) => x.id === id);
  if (e) return `ONWARD, PILOT // NEXT: ${e.hintShort}`;
  if (isBodyId(id)) return `ONWARD, PILOT // NEXT: CHART ${bodyById(id).name}`;
  return "ONWARD, PILOT // FOLLOW THE GLOW";
}

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
  /** The step the pending arrival or onward line is about (a string reference: no allocation). */
  private pendingId = "";
  private readonly last: Record<keyof GuideLines, number> = { called: -1, offering: -1, arrived: -1, allDone: -1 };

  private readonly lines: GuideLines;
  private readonly random: () => number;

  constructor(lines: GuideLines, random: () => number = Math.random) {
    this.lines = lines;
    this.random = random;
  }

  /**
   * Feed one guide step. `offered`: the run began as an offer (GuideState.offered),
   * whose line went out when it started, so its meeting the ship says nothing more.
   * `targetId`: the step the guide is at (GuideState.targetId), which the
   * arrival and onward lines name. Returns the line to broadcast now, or null.
   */
  update(event: GuideEvent | null, offered: boolean, now: number, busy: boolean, targetId = ""): string | null {
    const kind: LineKind | null =
      event === "met" ? (offered ? null : "called")
      : event === "offered" ? "offering"
      : event === "arrived" ? "arrived"
      : event === "onward" ? "onward"
      : event === "allDone" ? "allDone"
      : null;
    if (kind) { this.pending = kind; this.pendingAt = now; this.pendingId = targetId; }
    // The guide it was about has gone back to roaming: the line would be wrong.
    else if (event === "dismissed") this.pending = null;
    if (this.pending === null) return null;
    if (now - this.pendingAt > GUIDE_LINE_WAIT_S) { this.pending = null; return null; }
    if (busy) return null;
    const k = this.pending;
    this.pending = null;
    if (k === "onward") return onwardLine(this.pendingId);
    if (k === "arrived") return arrivalLine(this.pendingId) ?? this.pick(k);
    return this.pick(k);
  }

  /** A line from the pool, never the pool's previous one when it has another. */
  private pick(k: keyof GuideLines): string {
    const pool = this.lines[k];
    let i = Math.min(pool.length - 1, Math.floor(this.random() * pool.length));
    if (pool.length > 1 && i === this.last[k]) i = (i + 1) % pool.length;
    this.last[k] = i;
    return pool[i];
  }
}
