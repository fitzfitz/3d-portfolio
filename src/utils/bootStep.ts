import { BUNDLED_CONTENT, type ContentSource } from "../data/content";
import type { Loaded } from "./contentLoader";

/**
 * The content fetch as a labelled step on index.html's INITIALIZING overlay
 * (spec 2026-10-23-dynamic-content, the owner's loading call). The overlay
 * stays until React renders, so the step must always end: whatever `load`
 * does, the label reaches a final state and a Loaded comes back.
 */
export const BOOT_STEP_TEXT: Readonly<Record<"pending" | ContentSource, string>> = {
  pending: "SYNCING MISSION DATA...",
  api: "MISSION DATA: LIVE",
  cache: "MISSION DATA: LAST KNOWN",
  bundled: "MISSION DATA: ONBOARD",
};

/** Written into the overlay when App's code cannot load (a dropped connection, a stale deploy). */
export const BOOT_FAILED_TEXT = "SYSTEMS OFFLINE // RELOAD THE PAGE TO RETRY";

/**
 * Imports App (or anything) for main.tsx. A failed chunk would otherwise leave
 * the INITIALIZING overlay up for good: it writes BOOT_FAILED_TEXT and gives
 * null instead. Never rejects.
 */
export async function loadOrExplain<T>(load: () => Promise<T>, write: (text: string) => void): Promise<T | null> {
  try {
    return await load();
  } catch (e) {
    console.error("boot: the app failed to load", e);
    try { write(BOOT_FAILED_TEXT); } catch { /* no overlay */ }
    return null;
  }
}

export async function withBootStep(load: () => Promise<Loaded>, write: (text: string) => void): Promise<Loaded> {
  const show = (t: string) => { try { write(t); } catch { /* a missing overlay must not stop loading */ } };
  show(BOOT_STEP_TEXT.pending);
  try {
    const r = await load();
    show(BOOT_STEP_TEXT[r.source]);
    return r;
  } catch {
    show(BOOT_STEP_TEXT.bundled);
    return { content: BUNDLED_CONTENT, source: "bundled", refresh: Promise.resolve() };
  }
}

/** Writes the step into index.html's `#boot-step` line; nothing when it is gone (React already rendered). */
export function overlayWriter(doc: Document = document): (text: string) => void {
  return (text) => {
    const el = doc.getElementById("boot-step");
    if (el) el.textContent = text;
  };
}
