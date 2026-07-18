import { useEffect, useRef } from "react";
import { ChatterScheduler } from "../../utils/chatterScheduler";
import { chatterPools } from "../../data/chatterLines";
import { useSpaceStore } from "../../store/spaceStore";
import { soundManager } from "../../audio/soundManager";

/** Typewriter terminal line, bottom-center HUD. rAF + DOM writes, no React state. */
export default function RadioChatter() {
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scheduler = new ChatterScheduler(chatterPools);
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

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
        const s = useSpaceStore.getState();
        typeLine(
          s.isWarping
            ? scheduler.pick("warp")
            : scheduler.pick(s.activeZone ? "zone" : "ambient", s.activeZone)
        );
      }, scheduler.nextDelayMs());
    };

    // Zone entry + boundary wrap interrupt the ambient cadence immediately
    const unsubs = [
      useSpaceStore.subscribe(
        (s) => s.activeZone,
        (zone) => { if (zone) typeLine(scheduler.pick("zone", zone)); }
      ),
      useSpaceStore.subscribe(
        (s) => s.isTeleporting,
        (flash) => { if (flash) typeLine(scheduler.pick("wrap")); }
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
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 max-w-[60vw] pointer-events-none">
      <div ref={lineRef} className="font-mono text-[9px] text-primary/60 whitespace-nowrap overflow-hidden text-ellipsis" />
    </div>
  );
}
