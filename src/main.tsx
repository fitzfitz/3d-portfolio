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

/**
 * The projects and career come from beacon-api's D1 tables, and the scene's
 * landmarks (probes, buoys) are built from them at module load. So the content
 * settles first, and only then are App and everything it imports loaded
 * (spec 2026-10-23-dynamic-content, decision 4; tests/bootOrder.test.ts).
 * index.html's INITIALIZING overlay covers the wait: at most
 * CONTENT_TIMEOUT_MS on a first visit, none when an earlier visit cached it.
 */
async function boot() {
  const { content, source } = await loadContent(browserLoaderDeps())
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
