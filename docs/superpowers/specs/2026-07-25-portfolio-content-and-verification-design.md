# Portfolio Content & Verification Closure — Design

**Date:** 2026-07-25
**Status:** Approved by user (contact-form route, verification route, and section-by-section design all confirmed)

## Goal

Close the two gaps that keep a technically finished project from being a shippable CV:

1. **Content honesty.** The contact form fakes delivery while telling visitors it reached an
   inbox; four `https://github.com` links, one `https://linkedin.com`, and two
   `hello@example.com` addresses are placeholders; SEO carries no identity and no share image.
2. **Verification debt.** Every implementation plan ends in a "Pending human" paragraph. About
   33 acceptance checks across six plans were never confirmed, and no touch control has ever
   been exercised on a real device despite "must work with keyboard AND touch" being a standing
   constraint.

Part A (content) and Part B (verification) land in one spec because Part A's share image is
produced by the probe harness Part B builds. Sequencing is B-harness → B-probes → A.

## Decisions (user-confirmed)

1. **Contact form posts to a real third-party endpoint** (Web3Forms), env-driven, with the
   terminal-log theater rewired to the true request lifecycle and a mailto fallback on failure.
   Rejected: mailto-only (loses the set piece), and keeping the simulation with honest copy
   (ships a deliberately dead form on a CV).
2. **Verification closes as a committed e2e suite plus a human checklist** — objective checks
   become repeatable pass/fail scripts under `tests/e2e/`; subjective "feel" checks become a
   scripted `docs/QA-CHECKLIST.md` pass. Rejected: one-off throwaway probes (debt re-accrues on
   the next feature), and checklist-only (nothing machine-enforced afterward).

## Already closed during design

**Moon metalness** (flagged in the asset-uplift plan review as "bake_utils sets metal 0.55").
Not a defect: the 0.55 default is consumed only by `gen_cargo_ship.py` for a metal hull.
`gen_moon.py:52` passes `metallic=0.0`, and the shipped artifact confirms it — reading
`public/models/moon.glb` with the meshopt decoder registered yields `MoonBaked metal=0.00
rough=0.90`. Asteroids are 0.05/0.92 and the comet head 0.00/0.96, all correct for rock.
No work required; recorded here so the item is not re-litigated.

---

# Part A — Content honesty

## A1. Contact form

### Endpoint contract (verified against Web3Forms docs, 2026-07-25)

- `POST https://api.web3forms.com/submit`
- Headers: `Content-Type: application/json`, `Accept: application/json`
- Body: `access_key` (required), plus `name`, `email`, `message`, `subject`, `from_name`,
  `botcheck` (honeypot)
- Documented response shape is `{message, status}`; the live API also returns `success`.
  **Success is therefore `res.ok && json.success !== false`** — do not trust a single field.

### Extracted pure functions (`src/utils/contactForm.ts`)

Testable without a DOM or network:

- `buildPayload({name, email, message}, accessKey): object` — assembles the body, sets
  `subject` to `` `Inbound transmission from ${name}` ``, `from_name` to the sender's name,
  and `botcheck` to `""`.
- `buildMailto({name, email, message}, to): string` — `mailto:` URL with encoded subject and a
  body that preserves everything the visitor typed, so a failed send never loses the message.
- `classifyResponse(res, json): "ok" | "rejected" | "unreachable"` — `ok` per the rule above;
  `rejected` for a 4xx with a message (bad key, spam block); `unreachable` for a 5xx.
  **Thrown errors never reach this function** — an aborted or network-failed `fetch` rejects,
  so the call site maps any thrown error to `"unreachable"` directly. Stated explicitly because
  a `classifyResponse` that appears to cover timeouts but cannot is exactly the kind of
  ambiguity that produces an unhandled path.

### Component behavior (`src/components/sections/Contact.tsx`)

Three guarantees, each independently testable:

1. **Log lines are true.** The existing five lines claim PGP encryption and a dispatch to
   `smtp.fitzgeral.dev`, both fiction. Replacement lines are tied to real lifecycle stages and
   printed as they happen, not on a timer:
   - `> validating payload headers…` (after `validate()` passes)
   - `> serializing transmission packet…` (before `fetch`)
   - `> awaiting relay acknowledgement…` (request in flight)
   - terminal line prints the real outcome: `relay ack ${status} — transmission logged` or
     `RELAY UNREACHABLE — falling back to direct channel`
   Flavor is retained; every claim is now literally accurate.
2. **No silent lying.** When `import.meta.env.VITE_FORM_KEY` is empty (fresh clone with no
   `.env`), the component renders the mailto variant — a single themed `OPEN_TRANSMISSION`
   button plus the visible address — instead of the form. A form that cannot send never
   appears on screen.
3. **Failure is recoverable.** A 10s `AbortController` timeout prevents a hung request from
   leaving the spinner forever. On `rejected` or `unreachable`, the terminal prints the failure
   and the UI surfaces the `buildMailto()` link pre-filled with what they typed.

Existing field validation and error styling are unchanged. The success copy changes from
"has been encrypted and sent to my inbox" to text that matches what actually happened.

### Configuration

- `.env.example` (committed): `VITE_FORM_ENDPOINT`, `VITE_FORM_KEY` only — the contact address
  lives in `src/data/identity.ts` (see A2), not in env.
- `.env` must be added to `.gitignore`. The existing `*.local` pattern does **not** cover it.
- The Web3Forms access key is public by design; reading it from env keeps the service swappable
  without touching component code, and lets the empty-key path (A1 guarantee 2) be tested.

## A2. Identity swap

The placeholders are scattered across six sites in four files, which is *why* they survived to
now — there was no single place to look. Rather than swapping six strings, identity moves into
one module, following the repo's existing convention of content living in `constants.ts` /
`src/data/`:

### New module `src/data/identity.ts`

```ts
export const identity = {
  name: "…",              // <title>, og:title, footer byline
  callsign: "FITZGERAL_SYS",   // already used by the spawn banner
  email: "…",             // Contact, Footer, buildMailto()
  github: "…",
  linkedin: "…",
} as const
```

Consumers then reference `identity.*`:

| Location | Current | Becomes |
|---|---|---|
| `App.tsx:209` | `https://github.com` (`VIEW_PLANET_CODE` in orbit dossier) | `identity.github`, or a per-project `repo` field on `Project` when one exists |
| `Experience.tsx:155` | `https://github.com` | same |
| `Footer.tsx:24` | `https://github.com` | `identity.github` |
| `Footer.tsx:39` | `https://linkedin.com` | `identity.linkedin` |
| `Contact.tsx:249-250` | `hello@example.com` | `identity.email` |
| `Footer.tsx:54` | `hello@example.com` | `identity.email` |

The email is public content, not a secret, so it lives here rather than in env — an env-sourced
address would render blank on a fresh clone. **Only the Web3Forms key is env-sourced**, because
it is the one value that is per-deployment rather than per-person.

If individual projects have no public repos, `VIEW_PLANET_CODE` falls back to the profile rather
than 404ing — a dead link on a CV is worse than a general one. Adding an optional `repo?: string`
to the `Project` interface in `constants.ts` lets the three planets link precisely if repos exist
and degrade to the profile if not.

A unit test asserts no `example.com` or bare `github.com`/`linkedin.com` URL survives anywhere in
`src/`, so this class of placeholder cannot silently return.

## A3. SEO and share image

`index.html` gains: identity in `<title>`/`og:title`/`og:description`/`twitter:*`,
`og:site_name`, `theme-color: #020108`, and `og:image` + `twitter:image` → `/og.webp`.

`canonical` and `og:url` are **deliberately deferred** — there is no deploy URL yet — recorded
as a single marked TODO. The spec notes for whoever deploys: **`og:image` must become an
absolute URL at deploy time**, because Facebook resolves relative image paths inconsistently
even though Twitter tolerates them.

`public/og.webp` is generated, not hand-made: the Part B harness parks near a planet, enters
photo mode, orbits to a chosen angle, captures 1200×630, and runs it through `sharp`. Target
under 200KB. The generator is committed as `tests/e2e/ogimage.mjs` so the image can be
regenerated after any visual change.

---

# Part B — Verification closure

## B1. Debug bridge (`src/debug/bridge.ts` + `DebugBridge` component)

Probes currently cannot see inside the app, which is the sole reason ~24 objective checks were
filed as "pending human". The bridge is dev-only and dead-stripped from production builds by
Vite's `import.meta.env.DEV` constant folding:

```ts
if (import.meta.env.DEV) {
  window.__fitz = { store: useSpaceStore, flight, bodies, scene, gl, renderCount }
}
```

- `store`, `flight`, `bodies` — imported directly from `src/store/spaceStore.ts`
- `scene`, `gl` — published by a `<DebugBridge/>` component mounted inside `<Canvas>`, reading
  `useThree`
- `renderCount` — a dev-only `React.Profiler` wrapping the tree increments a counter, which is
  what converts "zero React renders during flight" from an aspiration into an assertion

**Verification that it costs nothing in production:** a build-output grep asserting `__fitz`
does not appear in `dist/assets/*.js`.

## B2. Harness (`tests/e2e/harness.mjs`)

Owns everything the existing gitignored probes duplicate by hand:

- Chrome launch (`puppeteer-core`, local Chrome, `--enable-unsafe-swiftshader`)
- **Port discovery** — existing probes hardcode `5174`; Vite defaults to `5173`. The harness
  probes candidates and fails with a clear message if no dev server is up.
- First-paint wait keyed on the canvas being present, not a fixed sleep
- `pageerror` and `console.error` captured and **promoted to test failures** (the old probes
  only printed them)
- Helpers: `fly(keys, ms)`, `read(path)`, `countInstances(name)`, `forceLowPerf()`,
  `seedShards(n)`, `frames(n)`
- Assertion helpers returning structured pass/fail so `npm run test:e2e` exits non-zero on
  any failure

Probe files stay short and declarative. Screenshots land in the scratchpad, not the repo.

## B3. Check inventory

Recounted from the six plans' "Pending human" paragraphs: **33 checks**, one already closed
(moon metalness), leaving 32 — **24 machine-assertable, 8 genuinely human**.

### Machine-assertable → `tests/e2e/*.probe.mjs`

| Probe file | Checks |
|---|---|
| `audio.probe.mjs` | mute toggle persists across reload; StrictMode single-init (one `AudioContext`); `AudioContext.state === "running"` and non-zero gain after gesture |
| `perf.probe.mjs` | belt instance count halves in low-perf; cargo 5→3; god rays / warp tunnel / corona absent in low-perf; **steady-flight render delta === 0** |
| `sky.probe.mjs` | star-layer parallax under turn; corona flicker over frames; nebula hue drift over 90s; meteor spawns; cloud-layer rotation delta; god-ray occlusion via pixel luminance behind a planet |
| `flight.probe.mjs` | radar blip accuracy vs `flight`/`bodies` including across the wrap seam; warp-tunnel orientation tracks `flight.heading`/`pitch` |
| `gameplay.probe.mjs` | shard pickup increments counter; collect-all fanfare (pre-seed 9, collect the 10th); asteroid ram increments `impactCount` with ≥0.5s cooldown; orbit-entry traces a ring around a *moving* body; scan loop end-to-end; comet-near announcement latency; chatter fires on zone change |
| `touch.probe.mjs` | under iPhone emulation: `TouchControls` actually renders (asserted first — it gates on `(pointer: coarse)`), joystick drives `flight.input.steer`/`thrust`, RISE/DIVE changes `flight.pitch`, SCAN sets `scanTarget` |
| `assets.probe.mjs` | cargo dish rotation delta across frames + close-up capture; comet-head tumble + capture; regen structural equivalence (see B4) |

**Steady state must be defined precisely** or the zero-render check is meaningless: deep space,
no `activeZone`, no `cometNear`, no scan, no altitude warning — then assert zero renders over
5s. Chatter and telemetry are DOM-written by design, so a nonzero delta is a real finding.

### Genuinely human → `docs/QA-CHECKLIST.md`

Banking feel on curves; climb/dive feel; C/X descend ergonomics; altitude-bar vs
dead-ahead-blip overlap aesthetics; chatter cadence (annoying or atmospheric?); asteroid ram
impact weight; real-device thumb reach on touch; audio mix balance.

Each entry gets exact keystrokes and an expected outcome. The harness's debug params make every
item reachable in seconds rather than two minutes of flying — that is the difference between a
checklist that gets run and one that does not.

## B4. Asset reproducibility

`generate.sh` already documents that meshopt re-encoding is non-deterministic, so byte-diffing
would fail spuriously. Comparison is **structural** — the properties the app actually depends
on: node names, material names, metalness/roughness, vertex counts within ±2%, file size within
budget. Regeneration writes to a scratch directory and **never overwrites `public/models/`**.

Honest coverage, contradicting the original plan step's assumption that a full re-run
reproduces everything:

| Asset | Reproducibility |
|---|---|
| `cargo_ship`, `creature`, `moon`, `comet_head` | fully regenerable — wired into `generate.sh` |
| `asteroids` | `gen_asteroids.py` exists but **is not wired into `generate.sh`** — wire it |
| `spaceship` | `uplift_spaceship.py` exists but is not wired; it transforms an input GLB rather than authoring from scratch, so the source asset is a required input — wire it and document the dependency |
| `portal_gateway`, `space_crystal`, `earth`/`mars`/`jupiter` textures | **no generator exists** — externally sourced, present only in gitignored `assets-src/` |

Regeneration can never be the safety net for the last five. The mitigation is provenance:
`assets-src/MANIFEST.md` recording source, license, and SHA-256 for every file, which is what
makes the deferred off-machine backup meaningful instead of a folder of mystery binaries.

## B5. Recording outcomes

Each plan's stale "Pending human" paragraph is replaced with the resolution: either
`closed by tests/e2e/<file>` or `confirmed by human pass 2026-07-25`. Plans keep their
historical `## Verification` sections; a new dated entry records this closure pass.

---

## Testing strategy

- **Unit (vitest):** `buildPayload`, `buildMailto`, `classifyResponse` — including the
  empty-key path that forces the mailto variant — plus a placeholder scan over `src/`
  asserting no `example.com` address and no bare `github.com`/`linkedin.com` URL survives.
- **E2E (`npm run test:e2e`):** everything in B3. Contact submission uses puppeteer request
  interception against a mocked endpoint so the suite never spams the real service; one
  manual live send verifies the real key separately.
- **Build assertion:** `__fitz` absent from `dist/assets/*.js`.
- **Existing gates unchanged:** `npm run build`, `npm run lint`, `npm test` (85 passing).

## Error handling and edge cases

- Missing `VITE_FORM_KEY` → mailto variant, no dead form (A1 guarantee 2)
- Request timeout / network failure / 5xx → `unreachable` → mailto fallback with typed content
  preserved
- 4xx with message → `rejected` → failure surfaced verbatim, not swallowed
- Honeypot `botcheck` populated → Web3Forms drops it server-side; UI still reports success so
  bots learn nothing
- No dev server when probes run → harness fails with an actionable message, not a timeout
- `TouchControls` not rendering under emulation → asserted explicitly, so a false pass is
  impossible if `(pointer: coarse)` stops matching

## Risks

**The probes are expected to find real defects**, most likely in steady-state render count and
low-perf gating — those two have never been measured. The implementation plan needs an
explicitly sized "fix what the probes catch" task; findings that turn out large enough to
warrant their own spec get filed rather than absorbed silently.

## Open inputs (block Part A only; all of Part B proceeds without them)

1. Public contact email
2. GitHub URL (and whether per-project repos exist)
3. LinkedIn URL
4. Name/handle for `<title>`, `og:title`, footer byline
5. Web3Forms access key (or "scaffold it" → env var left empty)

## Out of scope

Git remote, CI, deploy config, branch cleanup, README rewrite, code splitting,
`prefers-reduced-motion`, and the two lint warnings. These are the separately-tracked
infrastructure and code-quality items.
