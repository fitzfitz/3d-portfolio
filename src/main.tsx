import { StrictMode, Profiler } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/orbitron/latin-700.css'
import '@fontsource/orbitron/latin-800.css'
import '@fontsource/orbitron/latin-900.css'
import '@fontsource/outfit/latin-300.css'
import '@fontsource/outfit/latin-400.css'
import '@fontsource/outfit/latin-500.css'
import '@fontsource/outfit/latin-600.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-600.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import './index.css'
import { settleContent } from './data/content'
import { browserLoaderDeps, loadContent } from './utils/contentLoader'
import { overlayWriter, withBootStep } from './utils/bootStep'
import { loadAssetPack } from './utils/assetPack'
import { FLIES_AT_START } from './utils/flightGate'

/**
 * The projects and career come from beacon-api's D1 tables, and the scene's
 * landmarks (probes, buoys) are built from them at module load. So the content
 * settles first, and only then are App and everything it imports loaded
 * (spec 2026-10-23-dynamic-content, the owner's loading call;
 * tests/bootOrder.test.ts). The fetch is a step of the game's loading: it
 * shows on index.html's INITIALIZING overlay and runs alongside the asset
 * packs, which start here, so neither waits for the other. It is bounded by
 * CONTENT_TIMEOUT_MS and always resolves (fresh, else the last good copy,
 * else the bundled data).
 */
async function boot() {
  // The packs only when the canvas will mount, as before: a résumé link or a
  // browser without WebGL never downloads them. App's lazy canvas asks again
  // and gets this same promise; without packs (dev, e2e, ASSET_PACK=0) it is
  // an already-settled no-op, exactly as before.
  if (FLIES_AT_START) void loadAssetPack()
  const deps = browserLoaderDeps()
  const { content, source } = deps.base
    ? await withBootStep(() => loadContent(deps), overlayWriter())
    : await loadContent(deps)
  settleContent(content, source)
  const { default: App } = await import('./App.tsx')

  // Profiler counts React commits, which is exactly the quantity the
  // "zero React renders during flight" claim is about. Dev-only, with the
  // e2e bridge: in production this branch and both imports are dropped.
  let tree = <App />
  if (import.meta.env.DEV) {
    const { fitzDebug } = await import('./debug/bridge')
    ;(window as unknown as { __fitz: typeof fitzDebug }).__fitz = fitzDebug
    tree = (
      <Profiler id="app" onRender={() => { fitzDebug.renderCount++ }}>
        <App />
      </Profiler>
    )
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>{tree}</StrictMode>,
  )
}

void boot()
