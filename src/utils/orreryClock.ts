import { YEAR_S } from "../constants";
import { jdFromUnixMs, unixMsFromJd } from "./ephemeris";

/** Julian days of orrery time per game second: one Julian year per YEAR_S. */
export const ORRERY_DAYS_PER_SECOND = 365.25 / YEAR_S;

/** 2026-10-20 00:00 UTC, the date e2e probes pin. */
export const ORRERY_TEST_JD = 2461333.5;

/** Parses "?orrery=YYYY-MM-DD" to the JD at 00:00 UTC; null unless a real calendar date. */
export function parseOrreryParam(search: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(new URLSearchParams(search).get("orrery") ?? "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return jdFromUnixMs(ms);
}

/** Epoch precedence: finite global pin, then URL parameter, then the wall clock. */
export function resolveInitialEpoch(global: unknown, search: string, nowMs: number): number {
  if (typeof global === "number" && Number.isFinite(global)) return global;
  return parseOrreryParam(search) ?? jdFromUnixMs(nowMs);
}

// TT-UTC (about 69 s) is ignored.
let epochJd = resolveInitialEpoch(
  (globalThis as { __FITZ_ORRERY_JD__?: unknown }).__FITZ_ORRERY_JD__,
  typeof location !== "undefined" ? location.search : "",
  Date.now(),
);

export const orreryEpochJd = (): number => epochJd;
export const setOrreryEpochJd = (jd: number): void => {
  epochJd = jd;
};

export const orreryJd = (gameSeconds: number): number => epochJd + gameSeconds * ORRERY_DAYS_PER_SECOND;

/** "YYYY-MM-DD" in UTC. */
export const formatOrreryDate = (jd: number): string => new Date(unixMsFromJd(jd)).toISOString().slice(0, 10);
