/**
 * Which built files to <link rel="modulepreload"> so App's code downloads while
 * the content is still being fetched (vite.config.ts preloadApp; spec
 * 2026-10-23-dynamic-content, the owner's loading call). main.tsx imports App
 * only after the content settles, because App's modules read it when they are
 * evaluated. modulepreload fetches and parses a module without evaluating it,
 * so the content cannot freeze early. Pure: the build plugin hands it the
 * bundle's chunks. Used at build time only.
 */
export interface ChunkLike {
  fileName: string;
  facadeModuleId: string | null;
  /** Static imports only; a dynamic import (the lazy canvas) is not preloaded. */
  imports: readonly string[];
}

/**
 * The chunk built from the module whose id ends with `entrySuffix`, and every
 * chunk it imports statically, transitively; minus `skip` (files the page
 * already loads, e.g. the entry script). Empty when no chunk matches.
 */
export function preloadFiles(chunks: readonly ChunkLike[], entrySuffix: string, skip: ReadonlySet<string>): string[] {
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const entry = chunks.find((c) => c.facadeModuleId?.endsWith(entrySuffix));
  if (!entry) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    if (!skip.has(name)) out.push(name);
    for (const i of byName.get(name)?.imports ?? []) walk(i);
  };
  walk(entry.fileName);
  return out;
}
