import { checkBottleText, bottleReasonMessage, BOTTLE_MAX_CHARS } from "./bottleFilter";
import { dropFailureMessage, type DropResult } from "./beaconApi";

/**
 * The bottle panel's state, kept pure so it is testable without a DOM
 * (tests/bottlePanel.test.tsx). The text survives every failure: only a
 * successful send empties the box.
 */
export interface Draft {
  text: string;
  sending: boolean;
  /** The last send's failure, in friendly words; cleared by the next edit. */
  error: string | null;
}

export type DraftAction =
  | { type: "edit"; text: string }
  | { type: "sending" }
  | { type: "failed"; error: string }
  | { type: "sent" };

export const EMPTY_DRAFT: Draft = { text: "", sending: false, error: null };

export function draftReducer(d: Draft, a: DraftAction): Draft {
  switch (a.type) {
    case "edit": return { ...d, text: a.text, error: null };
    case "sending": return { ...d, sending: true, error: null };
    case "failed": return { ...d, sending: false, error: a.error };
    case "sent": return EMPTY_DRAFT;
  }
}

export interface DraftView {
  /** Characters typed (code points, as the filter counts them). */
  count: number;
  max: number;
  over: boolean;
  /** What to tell the pilot now: the send's failure, else the filter's reason, else nothing. */
  hint: string | null;
  canSend: boolean;
}

/**
 * The live counter and instant feedback: the same checkBottleText the Worker
 * runs, so the panel never lets through what the Worker would refuse for its
 * text. An empty box says nothing.
 */
export function draftView(d: Draft): DraftView {
  const count = Array.from(d.text).length;
  const over = count > BOTTLE_MAX_CHARS;
  const check = checkBottleText(d.text);
  const blank = d.text.trim() === "";
  const hint = d.error ?? (blank || check.ok ? null : bottleReasonMessage(check.reason));
  return { count, max: BOTTLE_MAX_CHARS, over, hint, canSend: !d.sending && !blank && check.ok && !over };
}

/** Sends `text` with `drop` and says what happened, as the reducer's next action. Never throws. */
export async function sendDraft(text: string, drop: (text: string) => Promise<DropResult>): Promise<DraftAction> {
  let r: DropResult;
  try {
    r = await drop(text);
  } catch {
    r = { ok: false, reason: "offline" };
  }
  return r.ok ? { type: "sent" } : { type: "failed", error: dropFailureMessage(r) };
}
