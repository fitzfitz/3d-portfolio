import { useEffect, useRef } from "react";
import { scanState } from "../../utils/scanState";
import { useMediaQuery } from "../../hooks/useMediaQuery";

const RING_MASK = "radial-gradient(circle, transparent 23px, #000 24px)";

/** HUD scan-progress ring: rAF straight to the DOM, reading module-scoped scanState — zero React renders. */
export default function ScanRing() {
  const containerRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const isCoarse = useMediaQuery("(pointer: coarse)");

  useEffect(() => {
    let raf: number;
    const tick = () => {
      const { progress, label } = scanState;
      if (ringRef.current) {
        ringRef.current.style.background = `conic-gradient(#00f0ff ${progress * 360}deg, rgba(255,255,255,0.08) 0)`;
      }
      if (labelRef.current) labelRef.current.textContent = label;
      if (containerRef.current) containerRef.current.style.opacity = label ? "1" : "0";
      // The hint is only useful before the first hold starts.
      if (hintRef.current) hintRef.current.style.visibility = progress > 0 ? "hidden" : "visible";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute bottom-40 left-1/2 -translate-x-1/2 pointer-events-none flex flex-col items-center gap-1.5 opacity-0"
    >
      {/* Masked to a thin ring. It used to be a disc with an opaque near-black
          centre, which read as a black hole under the ship. */}
      <div ref={ringRef} className="relative w-14 h-14 rounded-full"
        style={{ WebkitMask: RING_MASK, mask: RING_MASK }} />
      <div ref={labelRef} className="font-mono text-[10px] uppercase tracking-widest text-primary" />
      <div ref={hintRef} className="font-mono text-[9px] uppercase tracking-widest text-white/50">
        {isCoarse ? "HOLD SCAN" : "HOLD E TO SCAN"}
      </div>
    </div>
  );
}
