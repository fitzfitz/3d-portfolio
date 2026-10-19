import { packedUrl } from "./assetPack";

/** Every answer given so far, keyed by base and path (see assetUrl). */
const answered = new Map<string, string>();

/**
 * Composes a path to a file in `public/` against Vite's configured base URL.
 *
 * Why this exists: Vite rewrites asset references it can see at build time —
 * `<link href>`, `<script src>`, imported modules. It cannot see a *runtime*
 * fetch of a string literal, which is exactly what `useGLTF("/models/x.glb")`
 * and `useTexture("/models/x.webp")` are. Those strings are handed to a loader
 * at runtime and fetched verbatim, so a root-absolute literal 404s the moment
 * the app is served from anywhere other than the domain root (a GitHub Pages
 * project page serves from `/3d-portfolio/`).
 *
 * `import.meta.env.BASE_URL` is Vite's own view of the configured base, so this
 * cannot drift out of sync with `vite.config.ts`.
 *
 * `base` is injectable purely so the tests can pin behaviour at several bases
 * without stubbing `import.meta.env`. Production callers pass one argument.
 */
export function assetUrl(path: string, base: string = import.meta.env.BASE_URL): string {
  // The first answer for a path holds all page long: a remounting component
  // that got a loose URL before must not get a packed one now, or the new URL
  // would re-suspend the scene.
  const key = `${base}|${path}`;
  const known = answered.get(key);
  if (known) return known;
  // A production build ships public/models as asset packs
  // (utils/assetPack.ts); their files are answered from memory.
  const url = packedUrl(path) ?? compose(path, base);
  answered.set(key, url);
  return url;
}

function compose(path: string, base: string): string {
  // Normalise both sides rather than trusting one: Vite's BASE_URL always
  // carries a trailing slash, but a hand-set `base` in config or an env var
  // may not, and `//models/x.glb` is a protocol-relative URL — it would try to
  // fetch from a host named "models".
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
