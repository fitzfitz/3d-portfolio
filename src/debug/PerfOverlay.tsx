import { useEffect, useRef } from "react";
import { perfStats, percentile } from "./perfStats";

/**
 * DEV-only readout. Writes through a ref on rAF rather than React state --
 * a setState here would re-render App every frame and manufacture exactly
 * the problem this overlay exists to find.
 */
export default function PerfOverlay() {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const p50 = percentile(50);
        const p99 = percentile(99);
        el.textContent =
          `p50 ${p50.toFixed(1)}ms  p99 ${p99.toFixed(1)}ms\n` +
          `calls ${perfStats.calls}  tris ${perfStats.triangles}\n` +
          `programs ${perfStats.programs}  lights ${perfStats.lights}`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <pre
      ref={ref}
      className="fixed bottom-4 left-4 z-[100] pointer-events-none select-none
                 font-mono text-[10px] leading-relaxed text-primary/80
                 bg-black/70 border border-primary/20 rounded-lg px-3 py-2"
    />
  );
}
