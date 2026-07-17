import { useRef } from "react";
import { flight } from "../../store/spaceStore";
import { useMediaQuery } from "../../hooks/useMediaQuery";

const RADIUS = 56; // px travel of the joystick knob

/** Virtual joystick (left half) + boost button. Writes flight.input directly. */
export default function TouchControls() {
  const isCoarse = useMediaQuery("(pointer: coarse)");
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  if (!isCoarse) return null;

  const moveKnob = (dx: number, dy: number) => {
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = { x: e.clientX, y: e.clientY };
    if (baseRef.current) {
      baseRef.current.style.left = `${e.clientX - 72}px`;
      baseRef.current.style.top = `${e.clientY - 72}px`;
      baseRef.current.style.opacity = "1";
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!origin.current) return;
    const dx = Math.max(-RADIUS, Math.min(RADIUS, e.clientX - origin.current.x));
    const dy = Math.max(-RADIUS, Math.min(RADIUS, e.clientY - origin.current.y));
    flight.input.steer = dx / RADIUS;   // right = +1 (physics negates: stick right turns right)
    flight.input.thrust = -dy / RADIUS; // up = +1 forward, down = brake
    moveKnob(dx, dy);
  };

  const onPointerEnd = () => {
    origin.current = null;
    flight.input.steer = 0;
    flight.input.thrust = 0;
    moveKnob(0, 0);
    if (baseRef.current) baseRef.current.style.opacity = "0";
  };

  return (
    <>
      {/* Left-half touch zone: joystick appears where the finger lands */}
      <div
        className="fixed inset-y-0 left-0 w-1/2 z-40 pointer-events-auto touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div
          ref={baseRef}
          className="absolute w-36 h-36 rounded-full border border-primary/30 bg-black/40 opacity-0 transition-opacity duration-150 flex items-center justify-center"
        >
          <div ref={knobRef} className="w-14 h-14 rounded-full bg-primary/25 border border-primary/60" />
        </div>
      </div>

      {/* Boost button */}
      <button
        className="fixed bottom-24 right-8 z-40 pointer-events-auto touch-none w-20 h-20 rounded-full border border-secondary/40 bg-black/50 font-mono text-[10px] text-secondary active:bg-secondary/20"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); flight.input.boost = true; }}
        onPointerUp={() => { flight.input.boost = false; }}
        onPointerCancel={() => { flight.input.boost = false; }}
      >
        BOOST
      </button>
    </>
  );
}
