import { useEffect, useRef } from "react";
import { useSpaceStore } from "../../store/spaceStore";
import { bottleCardMeta, type Bottle } from "../../utils/beacons";
import { bottleCardState } from "../../utils/bottleCard";
import { setStyle, setText } from "../../utils/domWrite";

const GLASS = "#5fd3a8";
const MINE = "#ec4899";

/**
 * The read card for the message in a bottle you are passing, or just scanned
 * (spec "Seeing and reading bottles"): the note, the country and how long
 * ago. It unrolls from the top when a bottle comes within reach and rolls up
 * when you fly on. rAF + change-guarded DOM writes, zero renders, like
 * BuoyCard; the text is rewritten only when the bottle changes.
 *
 * The note is set with textContent only, so it can never become markup or a
 * link. Hidden from screen readers like BuoyCard: scanning reads the same
 * note on the radio, which is announced.
 *
 * Desktop: top right, under the TARGET readout (and its probe tip or
 * gravity warning), clear of the left-hand telemetry at any width, the
 * controls card, the buoy card and the radio. Phones: the buoy card's slot,
 * left-aligned and narrow, clear of the right-hand touch column.
 */
export default function BottleCard() {
  const reducedMotion = useSpaceStore((s) => s.reducedMotion);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const metaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let shown: Bottle | null | undefined; // undefined forces the first write, including after a remount
    let shownOwn = false;
    const tick = () => {
      const st = useSpaceStore.getState();
      const b = st.showBottles ? bottleCardState.bottle : null;
      const own = bottleCardState.own;
      if (b !== shown || own !== shownOwn) {
        shown = b; shownOwn = own;
        const root = rootRef.current;
        if (root) root.dataset.bottle = b?.id ?? "";
        if (b) {
          setText(tagRef.current, own ? "YOUR_BOTTLE" : "MESSAGE_BOTTLE");
          setStyle(tagRef.current, "color", own ? MINE : GLASS);
          setText(textRef.current, b.text);
          setText(metaRef.current, bottleCardMeta(b, Date.now()));
        }
        setStyle(cardRef.current, "opacity", b ? "1" : "0");
        setStyle(cardRef.current, "transform", b ? "scaleY(1)" : "scaleY(0.08)");
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={rootRef} data-testid="bottle-card" data-bottle="" aria-hidden="true"
      className="absolute bottom-[16rem] left-4 w-[calc(100vw-9rem)] sm:bottom-auto sm:top-48 sm:left-auto sm:right-6 sm:w-[min(40vw,22rem)] pointer-events-none">
      <div ref={cardRef}
        className={`origin-top rounded-xl border bg-black/80 px-4 py-2 sm:py-3 ${reducedMotion ? "" : "transition-[opacity,transform] duration-300 ease-out"}`}
        style={{ borderColor: `${GLASS}55`, opacity: 0, transform: "scaleY(0.08)" }}>
        <div ref={tagRef} className="text-[9px] tracking-widest mb-1" style={{ color: GLASS }} />
        <p ref={textRef} data-testid="bottle-card-text"
          className="font-display text-sm text-[#f3e6c4] leading-snug [overflow-wrap:anywhere]" />
        <div ref={metaRef} data-testid="bottle-card-meta" className="text-[9px] tracking-wider text-white/50 mt-1.5" />
      </div>
    </div>
  );
}
