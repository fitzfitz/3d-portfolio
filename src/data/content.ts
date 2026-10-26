import projectsData from "./projects.json";
import { BUNDLED_CAREER, type CareerEntry } from "./career";

/**
 * The portfolio's content: the projects and the career history
 * (docs/superpowers/specs/2026-10-23-dynamic-content-design.md). It comes
 * from beacon-api's D1 tables (GET /content) when that answers, else from the
 * bundled snapshot below (projects.json, career.ts).
 *
 * Landmark positions are derived from it at module load (PROBES, BUOYS), so it
 * is settled once, before App's modules load (main.tsx), and never changes
 * during a visit. Import-light on purpose: main.tsx imports this before
 * anything that reads it.
 */
export interface Project {
  /**
   * Stable identity: the project's probe id only (data/probes.ts), the
   * store's `openDossier`/`probeNear` value and its logbook essential. No
   * body keys on it any more: the planets are the real Solar System's, with
   * their own ids (data/bodyIds.ts). Changing it renames the probe and breaks
   * any saved reference to it.
   */
  id: string;
  title: string; role: string; duration: string; short: string;
  description: string; tech: string[]; color: string;
  /** Public repo URL. Falls back to the profile when a project has none. */
  repo?: string;
}

export interface Content { projects: readonly Project[]; career: readonly CareerEntry[] }
/** Where the settled content came from: the bundled snapshot, an earlier visit's cached response, or the API now. */
export type ContentSource = "bundled" | "cache" | "api";

/**
 * The snapshot that ships with the site: first visits that time out, offline,
 * an empty or failing API, an old Worker, dev and e2e. tests/projects.test.ts
 * checks projects.json, which TypeScript cannot.
 */
export const BUNDLED_CONTENT: Content = { projects: projectsData, career: BUNDLED_CAREER };

let settled: { content: Content; source: ContentSource } | null = null;

/**
 * Settles the content for this visit. Refused (false, with a warning) once
 * anything has read it or it was settled before: a landmark built from one
 * list must never meet another (spec decision 4).
 */
export function settleContent(content: Content, source: ContentSource): boolean {
  if (settled) {
    console.warn(`content: already settled from ${settled.source}; ignoring the ${source} content for this visit`);
    return false;
  }
  settled = { content, source };
  return true;
}

/** The content for this visit. The first read freezes it (the bundled snapshot if nothing settled it). */
export function activeContent(): Content {
  settled ??= { content: BUNDLED_CONTENT, source: "bundled" };
  return settled.content;
}

export function contentSource(): ContentSource {
  activeContent();
  return settled!.source;
}
