import { StrictMode, Profiler } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { fitzDebug } from './debug/bridge'

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
