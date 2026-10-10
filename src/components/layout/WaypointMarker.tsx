import { useEffect, useRef } from "react";
import { waypointState } from "../../utils/waypointState";

/**
 * HUD waypoint toward the next unread dossier: a bracket on the target when it
 * is on screen, an edge arrow when it isn't. rAF + DOM writes, zero renders.
 */
export default function WaypointMarker() {
  const rootRef = useRef<HTMLDivElement>(null);
  const bracketRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const w = waypointState;
      const root = rootRef.current;
      if (root) {
        root.style.opacity = w.active ? "1" : "0";
        root.style.transform = `translate(${w.x.toFixed(1)}px, ${w.y.toFixed(1)}px)`;
        root.style.color = w.color;
      }
      if (bracketRef.current) bracketRef.current.style.display = w.onScreen ? "block" : "none";
      if (arrowRef.current) {
        arrowRef.current.style.display = w.onScreen ? "none" : "block";
        arrowRef.current.style.transform = `translate(-50%, -50%) rotate(${w.angle.toFixed(3)}rad)`;
      }
      if (labelRef.current) labelRef.current.textContent = `${w.label} · ${Math.round(w.distance)}u`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={rootRef} className="absolute left-0 top-0 pointer-events-none opacity-0" aria-hidden="true">
      {/* On-screen: corner bracket around the target */}
      <div ref={bracketRef}
        className="absolute -translate-x-1/2 -translate-y-1/2 w-9 h-9 border-2 border-current rounded-md opacity-80"
        style={{ clipPath: "polygon(0 0,35% 0,35% 12%,12% 12%,12% 35%,0 35%,0 65%,12% 65%,12% 88%,35% 88%,35% 100%,0 100%,0 0,100% 0,100% 100%,65% 100%,65% 88%,88% 88%,88% 65%,100% 65%,100% 35%,88% 35%,88% 12%,65% 12%,65% 0,100% 0)" }} />
      {/* Off-screen: chevron on the viewport edge pointing toward it */}
      <div ref={arrowRef} className="absolute font-mono text-lg leading-none">➤</div>
      <div ref={labelRef}
        className="absolute left-1/2 top-6 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] tracking-wider" />
    </div>
  );
}
