import { useEffect, useRef } from "react";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { useMediaQuery } from "../../hooks/useMediaQuery";

const RADIUS = 56; // px travel of the joystick knob

/** Virtual joystick (left half) + boost button. Writes flight.input directly. */
export default function TouchControls() {
  const isCoarse = useMediaQuery("(pointer: coarse)");
  const isOrbitLocked = useSpaceStore((s) => s.isOrbitLocked);
  const scanTarget = useSpaceStore((s) => s.scanTarget);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const activePointerId = useRef<number | null>(null);
  const boostPointerRef = useRef<number | null>(null);
  const risepointer = useRef<number | null>(null);
  const divepointer = useRef<number | null>(null);
  const scanPointerRef = useRef<number | null>(null);

  // Reset flight.input and clear pointer tracking when orbit lock engages mid-interaction
  useEffect(() => {
    if (isOrbitLocked) {
      flight.input.steer = 0;
      flight.input.thrust = 0;
      flight.input.boost = false;
      flight.input.ascend = false;
      flight.input.descend = false;
      flight.input.scan = false;
      activePointerId.current = null;
      boostPointerRef.current = null;
      risepointer.current = null;
      divepointer.current = null;
      scanPointerRef.current = null;
    }
  }, [isOrbitLocked]);

  // Reset scan input/pointer when the target leaves range mid-hold (button unmounts underneath the finger)
  useEffect(() => {
    if (scanTarget === null) {
      flight.input.scan = false;
      scanPointerRef.current = null;
    }
  }, [scanTarget]);

  // Reset flight.input on unmount to prevent stuck inputs when component is removed
  useEffect(() => () => {
    flight.input.steer = 0;
    flight.input.thrust = 0;
    flight.input.boost = false;
    flight.input.ascend = false;
    flight.input.descend = false;
    flight.input.scan = false;
    risepointer.current = null;
    divepointer.current = null;
    scanPointerRef.current = null;
  }, []);

  if (!isCoarse || isOrbitLocked) return null;

  const moveKnob = (dx: number, dy: number) => {
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (activePointerId.current !== null) return; // Ignore second touches
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointerId.current = e.pointerId;
    origin.current = { x: e.clientX, y: e.clientY };
    if (baseRef.current) {
      baseRef.current.style.left = `${e.clientX - 72}px`;
      baseRef.current.style.top = `${e.clientY - 72}px`;
      baseRef.current.style.opacity = "1";
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerId !== activePointerId.current || !origin.current) return;
    const dx = Math.max(-RADIUS, Math.min(RADIUS, e.clientX - origin.current.x));
    const dy = Math.max(-RADIUS, Math.min(RADIUS, e.clientY - origin.current.y));
    flight.input.steer = dx / RADIUS;   // right = +1 (physics negates: stick right turns right)
    flight.input.thrust = -dy / RADIUS; // up = +1 forward, down = brake
    moveKnob(dx, dy);
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    if (e.pointerId !== activePointerId.current) return;
    activePointerId.current = null;
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

      {/* Rise button */}
      <button
        className="fixed bottom-64 right-9 z-40 pointer-events-auto touch-none w-14 h-14 rounded-full border border-primary/40 bg-black/50 font-mono text-[10px] text-primary active:bg-primary/20"
        onPointerDown={(e) => {
          if (risepointer.current !== null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          risepointer.current = e.pointerId;
          flight.input.ascend = true;
        }}
        onPointerUp={(e) => {
          if (e.pointerId === risepointer.current) {
            risepointer.current = null;
            flight.input.ascend = false;
          }
        }}
        onPointerCancel={(e) => {
          if (e.pointerId === risepointer.current) {
            risepointer.current = null;
            flight.input.ascend = false;
          }
        }}
      >
        ▲ PITCH
      </button>

      {/* Dive button */}
      <button
        className="fixed bottom-48 right-9 z-40 pointer-events-auto touch-none w-14 h-14 rounded-full border border-primary/40 bg-black/50 font-mono text-[10px] text-primary active:bg-primary/20"
        onPointerDown={(e) => {
          if (divepointer.current !== null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          divepointer.current = e.pointerId;
          flight.input.descend = true;
        }}
        onPointerUp={(e) => {
          if (e.pointerId === divepointer.current) {
            divepointer.current = null;
            flight.input.descend = false;
          }
        }}
        onPointerCancel={(e) => {
          if (e.pointerId === divepointer.current) {
            divepointer.current = null;
            flight.input.descend = false;
          }
        }}
      >
        ▼ PITCH
      </button>

      {/* Scan button — only shown while a scannable target is in range */}
      {scanTarget !== null && (
        <button
          className="fixed bottom-80 right-9 z-40 pointer-events-auto touch-none w-14 h-14 rounded-full border border-secondary/40 bg-black/50 font-mono text-[10px] text-secondary active:bg-secondary/20"
          onPointerDown={(e) => {
            if (scanPointerRef.current !== null) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            scanPointerRef.current = e.pointerId;
            flight.input.scan = true;
          }}
          onPointerUp={(e) => {
            if (e.pointerId === scanPointerRef.current) {
              scanPointerRef.current = null;
              flight.input.scan = false;
            }
          }}
          onPointerCancel={(e) => {
            if (e.pointerId === scanPointerRef.current) {
              scanPointerRef.current = null;
              flight.input.scan = false;
            }
          }}
        >
          SCAN
        </button>
      )}

      {/* Boost button */}
      <button
        className="fixed bottom-24 right-8 z-40 pointer-events-auto touch-none w-20 h-20 rounded-full border border-secondary/40 bg-black/50 font-mono text-[10px] text-secondary active:bg-secondary/20"
        onPointerDown={(e) => {
          if (boostPointerRef.current !== null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          boostPointerRef.current = e.pointerId;
          flight.input.boost = true;
        }}
        onPointerUp={(e) => {
          if (e.pointerId !== boostPointerRef.current) return;
          boostPointerRef.current = null;
          flight.input.boost = false;
        }}
        onPointerCancel={(e) => {
          if (e.pointerId !== boostPointerRef.current) return;
          boostPointerRef.current = null;
          flight.input.boost = false;
        }}
      >
        BOOST
      </button>
    </>
  );
}
