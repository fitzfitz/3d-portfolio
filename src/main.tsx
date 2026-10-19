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
import App from './App.tsx'
import { fitzDebug } from './debug/bridge'
import { registerServiceWorker } from './utils/serviceWorker'

if (import.meta.env.DEV) {
  (window as unknown as { __fitz: typeof fitzDebug }).__fitz = fitzDebug
}

// Profiler counts React commits, which is exactly the quantity the
// "zero React renders during flight" claim is about. Dev-only: in production
// the ternary folds to <App /> and the Profiler import is dropped.
const tree = import.meta.env.DEV ? (
  <Profiler id="app" onRender={() => { fitzDebug.renderCount++ }}>
    <App />
  </Profiler>
) : (
  <App />
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>{tree}</StrictMode>,
)

if (import.meta.env.PROD) registerServiceWorker()
