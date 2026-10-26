# Working rules for AI assistants

## Work size decides process
- Small changes (a fix, a tweak, a copy change, a config change, a single-area refactor): a short written description, then build, test, one review, PR.
- Only real features or cross-cutting refactors get the full spec, plan and task-by-task review process.
- Don't run look-polish rounds on small residuals.

## Asset detail bar
- Realistic at normal play viewing is enough. Never polish what only shows at extreme close-up.
- For new characters or art, prefer bought or commissioned models over writing new procedural Blender generators. Record licences in `assets-src/MANIFEST.md`.
- Check models in the monster lab: `npm run dev`, then `/monster-lab.html`.
- The existing generators stay as they are.

## Deploy rules
- Main deploys staging (GitHub Pages).
- A `v*` tag deploys production (Cloudflare `3d-portfolio` Worker, porto.fitzgeral.my.id): `gh release create vX.Y.Z --target main`.
- Production deploys need the owner's word.
- Never run a bare `wrangler deploy` in this repo. The root `wrangler.jsonc` is the production site.
- beacon-api always uses `--config beacon-api/wrangler.toml`.

## Before merging
- Run `npm run build` (it type-checks `tests/` too), `npx vitest run`, and the full e2e (`npm run test:e2e`) in the main checkout.
- Agent worktrees symlink `node_modules`, which gives false e2e failures.

## Every PR
- Add a changelog entry in `src/data/changelog.ts` (see `tests/changelog.test.ts`).

## Docs
- `docs/README.md` maps the current docs. New specs and plans go in `docs/superpowers/`, and move to `docs/archive/` once shipped.

## Agents and subagents
- Never kill processes by name (no `pkill`, no `kill -9` by name).
- Never install packages.
