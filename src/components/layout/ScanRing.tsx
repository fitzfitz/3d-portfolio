import { useEffect, useRef } from "react";
import { scanState } from "../canvas/Scanner";

/** HUD scan-progress ring: rAF straight to the DOM, reading module-scoped scanState — zero React renders. */
export default function ScanRing() {
  const containerRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf: number;
    const tick = () => {
      const { progress, label } = scanState;
      if (ringRef.current) {
        ringRef.current.style.background = `conic-gradient(#00f0ff ${progress * 360}deg, rgba(255,255,255,0.08) 0)`;
      }
      if (labelRef.current) labelRef.current.textContent = label;
      if (containerRef.current) containerRef.current.style.opacity = label ? "1" : "0";
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
      <div ref={ringRef} className="relative w-14 h-14 rounded-full">
        <div className="absolute inset-1 rounded-full bg-[#020108]" />
      </div>
      <div ref={labelRef} className="font-mono text-[8px] uppercase tracking-widest text-primary" />
    </div>
  );
}
