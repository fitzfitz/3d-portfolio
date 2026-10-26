import { parseBottles, validatePosition, BOTTLE_DAILY_CAP, type Bottle, type BottleRateReason } from "./beacons";
import { checkBottleText, bottleReasonMessage, type BottleRejectReason } from "./bottleFilter";
import { beaconApiUrl } from "./apiBase";

/** Re-exported: the URL lives in apiBase.ts so the content loader can read it without loading beacons.ts. */
export { beaconApiUrl };

/** The newest bottles in the sky. Silent on failure: an empty sky is a valid sky. */
export async function fetchBottles(): Promise<Bottle[]> {
  const base = beaconApiUrl();
  if (!base) return [];
  try {
    const res = await fetch(`${base}/beacons`);
    if (!res.ok) return [];
    return parseBottles(await res.json());
  } catch {
    return [];
  }
}

export interface BottleDrop { x: number; y: number; z: number; text: string }

/**
 * Why a drop failed. `invalid` is a local position failure (the spawn pad);
 * `rejected` is the text filter, local or the Worker's 400; `rate` is a 429
 * with the Worker's reason and seconds to wait (null when it gave none);
 * `refused` is any other 400; `offline` is everything else.
 */
export type DropFailure =
  | { ok: false; reason: "offline" | "invalid" | "refused" }
  | { ok: false; reason: "rejected"; filter: BottleRejectReason }
  | { ok: false; reason: "rate"; rate: BottleRateReason; retryAfter: number | null };
export type DropResult = { ok: true; bottle: Bottle } | DropFailure;

const FILTER_REASONS: readonly string[] = ["too_short", "too_long", "contact", "profanity", "junk"] satisfies BottleRejectReason[];
const RATE_REASONS: readonly string[] = ["wait", "daily", "busy"] satisfies BottleRateReason[];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  try {
    const b: unknown = await res.json();
    return isObj(b) ? b : {};
  } catch {
    return {};
  }
}
const seconds = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/**
 * Sends a bottle. The text runs through the same filter the Worker runs
 * first, so a note it would refuse never leaves the browser; the Worker
 * stays the authority.
 */
export async function postBottle(drop: BottleDrop): Promise<DropResult> {
  const base = beaconApiUrl();
  if (!base) return { ok: false, reason: "offline" };
  const checked = checkBottleText(drop.text);
  if (!checked.ok) return { ok: false, reason: "rejected", filter: checked.reason };
  const pos = validatePosition(drop);
  if (!pos.ok) return { ok: false, reason: "invalid" };
  try {
    const res = await fetch(`${base}/beacons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...pos.pos, text: checked.text }),
    });
    if (res.status === 429) {
      const body = await jsonOf(res);
      const rate = typeof body.reason === "string" && RATE_REASONS.includes(body.reason) ? body.reason as BottleRateReason : "wait";
      const header = res.headers.get("Retry-After");
      const retryAfter = seconds(body.retryAfter) ?? (header !== null && /^\d+$/.test(header) ? Number(header) : null);
      return { ok: false, reason: "rate", rate, retryAfter };
    }
    if (res.status === 400) {
      const body = await jsonOf(res);
      if (body.error === "rejected" && typeof body.reason === "string" && FILTER_REASONS.includes(body.reason)) {
        return { ok: false, reason: "rejected", filter: body.reason as BottleRejectReason };
      }
      return { ok: false, reason: "refused" };
    }
    if (!res.ok) return { ok: false, reason: "offline" };
    const [bottle] = parseBottles({ beacons: [(await jsonOf(res)).beacon] });
    return bottle ? { ok: true, bottle } : { ok: false, reason: "offline" };
  } catch {
    return { ok: false, reason: "offline" };
  }
}

/** Seconds as "6:12", or "3:12:05" past an hour. Rounded up, never "0:00". */
export function formatWait(s: number): string {
  const total = Math.max(1, Math.ceil(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** The friendly, specific words for a failed drop (spec "Writing a note"). */
export function dropFailureMessage(f: DropFailure): string {
  switch (f.reason) {
    case "rejected": return bottleReasonMessage(f.filter);
    case "rate": {
      const t = f.retryAfter === null ? null : formatWait(f.retryAfter);
      if (f.rate === "daily") return `${BOTTLE_DAILY_CAP} bottles a day is the limit. ${t ? `Next in ${t}.` : "Try again tomorrow."}`;
      if (f.rate === "busy") return `Lots of bottles are landing right now. ${t ? `Try again in ${t}.` : "Try again soon."}`;
      return `One bottle every 10 minutes. ${t ? `Next in ${t}.` : "Try again soon."}`;
    }
    case "invalid": return "Too close to the spawn pad. Fly out a little first.";
    case "refused": return "The relay refused this bottle.";
    default: return "The bottle relay is offline. Try again later.";
  }
}
