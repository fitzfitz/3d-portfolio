import { useEffect, useRef } from "react";
import { ChatterScheduler } from "../../utils/chatterScheduler";
import { chatterPools } from "../../data/chatterLines";
import { useSpaceStore } from "../../store/spaceStore";
import { soundManager } from "../../audio/soundManager";
import { flavourAllowed, holdUntil } from "../../utils/radioHold";

/** Typewriter terminal line, bottom-center HUD. rAF + DOM writes, no React state. */
export default function RadioChatter() {
  const lineRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scheduler = new ChatterScheduler(chatterPools);
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    // performance.now() until which a content broadcast owns the line.
    let heldUntil = 0;

    const typeLine = (text: string) => {
      if (disposed || !lineRef.current) return;
      cancelAnimationFrame(raf);
      soundManager.uiTick();
      const el = lineRef.current;
      const full = `> ${text}`;
      const startedAt = performance.now();
      const type = () => {
        if (disposed) return;
        const chars = Math.min(full.length, Math.floor((performance.now() - startedAt) / 22));
        el.textContent = full.slice(0, chars);
        if (chars < full.length) raf = requestAnimationFrame(type);
      };
      raf = requestAnimationFrame(type);
      scheduleAmbient();
    };

    const scheduleAmbient = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const now = performance.now();
        // A broadcast is still on the line: try again once its hold ends.
        if (!flavourAllowed(now, heldUntil)) {
          timer = setTimeout(scheduleAmbient, heldUntil - now);
          return;
        }
        const s = useSpaceStore.getState();
        typeLine(
          s.isWarping
            ? scheduler.pick("warp")
            : scheduler.pick(s.activeZone ? "zone" : "ambient", s.activeZone)
        );
      }, scheduler.nextDelayMs());
    };

    // Flavour lines (zone entry, comet, altitude, impact) never overwrite a
    // held broadcast; they are dropped, not queued.
    const flavour = (pick: () => string) => {
      if (flavourAllowed(performance.now(), heldUntil)) typeLine(pick());
    };

    // Zone entry interrupts the ambient cadence immediately
    const unsubs = [
      useSpaceStore.subscribe(
        (s) => s.activeZone,
        (zone) => { if (zone) flavour(() => scheduler.pick("zone", zone)); }
      ),
      useSpaceStore.subscribe(
        (s) => s.cometNear,
        (near) => { if (near) flavour(() => scheduler.pick("comet")); }
      ),
      useSpaceStore.subscribe(
        (s) => s.altitudeWarn,
        (warn) => { if (warn) flavour(() => scheduler.pick("altitude")); }
      ),
      useSpaceStore.subscribe(
        (s) => s.broadcast,
        (b) => {
          if (!b) return;
          typeLine(b.text);
          heldUntil = holdUntil(performance.now(), b);
          // Broadcasts carry real content (shard facts, scan reports, the
          // completion pointer). Announce them whole: the typewriter line
          // changes every 22ms and would be noise to a screen reader. Silent
          // lines (hails, flavour callouts) are shown but not announced.
          if (liveRef.current && !b.silent) liveRef.current.textContent = b.text;
        }
      ),
      useSpaceStore.subscribe(
        (s) => s.impactCount,
        () => flavour(() => scheduler.pick("impact"))
      ),
    ];

    typeLine(scheduler.pick("ambient"));

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      unsubs.forEach((u) => u());
    };
  }, []);

  return (
    // Phones: left-aligned, clear of the BOOST button on the right.
    <div className="absolute bottom-16 left-4 w-[55vw] sm:bottom-20 sm:left-1/2 sm:-translate-x-1/2 sm:w-[min(60vw,640px)] pointer-events-none">
      {/* Wraps instead of truncating: scan reports and shard facts are the
          payoff for the action, and a single ellipsised line cut them off. */}
      <div ref={liveRef} className="sr-only" aria-live="polite" />
      <div ref={lineRef} data-testid="radio-chatter" aria-hidden="true" className="font-mono text-[10px] leading-snug text-primary/80 sm:text-center" />
    </div>
  );
}
