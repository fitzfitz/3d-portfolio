import { StrictMode, Profiler } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { fitzDebug } from './debug/bridge'

if (import.meta.env.DEV) {
  (window as unknown as { __fitz: typeof fitzDebug }).__fitz = fitzDebug
  // Animation calibration cannot be verified by measurement — a probe can prove
  // a value changed while that change is invisible on screen. So the knob is
  // announced rather than hidden, because the only way to tune it is by eye.
  // eslint-disable-next-line no-console
  console.info(
    "%c[fitz] animation tuning%c  __fitz.setAnimScale(n)  — 1 = committed values, try 2/4/8. " +
    "Sweep it, then tell me the value that looks right and it gets baked in.",
    "font-weight:bold;color:#00ff87", "color:inherit"
  )
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
