import { useEffect, useRef } from "react";
import { combat, flight, useSpaceStore } from "../../store/spaceStore";
import { NEST_CENTRE, NEST_RED } from "../../data/nest";
import { flashOpacity, nestBanner, nestHazeOpacity, type NestBannerText } from "../../utils/combat/nestHud";
import { setStyle, setText } from "../../utils/domWrite";

/**
 * The Nest's screen layer (spec 2026-10-27-combat "HUD"): the red zone-edge
 * haze (within 30 u of the 70 u edge), the hull-hit flash and the banners
 * (ENTERING THE NEST, the countdown, NEST CLEARED, HULL BREACH, or the
 * offline line when the models failed to load).
 *
 * A DOM layer, not a scene object, like EdgeHaze: no shader program. One
 * full-window element, out of display whenever nothing shows (a full-window
 * layer at opacity 0 still costs compositor tiles, PRs #51–#53), with its
 * three parts inside, each out of display when idle. One rAF loop writes
 * straight to the DOM through setStyle / setText, which skip unchanged
 * writes, so at rest it writes nothing and flight never renders React. No
 * backdrop-filter (tests/noBackdropFilter.test.ts). Under reduced motion the
 * flash is a static tint (nestHud.ts flashOpacity), marked data-mode="static".
 */
export default function NestOverlay() {
  const rootRef = useRef<HTMLDivElement>(null);
  const hazeRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const banner: NestBannerText = { title: "", sub: "" };
    const tick = () => {
      const s = useSpaceStore.getState();
      const now = performance.now() / 1000;
      const n = combat.nest;
      const reduced = s.reducedMotion;
      const dist = Math.hypot(flight.x - NEST_CENTRE[0], flight.y - NEST_CENTRE[1], flight.z - NEST_CENTRE[2]);
      const haze = nestHazeOpacity(dist);
      const flash = flashOpacity(now, combat.flashAt, reduced);
      // Banners are HUD: none in a photo.
      const text = s.photoMode ? null : nestBanner(now, combat, n.phase, n.phaseT, combat.warm, banner);
      const on = haze > 0 || flash > 0 || text !== null;
      // Every part's display is kept current (unchanged writes are skipped),
      // so a part never reads as shown while the layer is out of display.
      setStyle(rootRef.current, "display", on ? "" : "none");
      setStyle(hazeRef.current, "display", haze > 0 ? "" : "none");
      if (haze > 0) setStyle(hazeRef.current, "opacity", haze.toFixed(3));
      setStyle(flashRef.current, "display", flash > 0 ? "" : "none");
      if (flash > 0) setStyle(flashRef.current, "opacity", flash.toFixed(3));
      const mode = reduced ? "static" : "fade";
      if (flashRef.current && flashRef.current.dataset.mode !== mode) flashRef.current.dataset.mode = mode;
      setStyle(bannerRef.current, "display", text ? "" : "none");
      if (text) {
        setText(titleRef.current, text.title);
        setText(subRef.current, text.sub);
        setStyle(subRef.current, "display", text.sub ? "" : "none");
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={rootRef} data-testid="nest-overlay"
      className="pointer-events-none fixed inset-0 z-[35]" style={{ display: "none" }}>
      <div ref={hazeRef} data-testid="nest-haze" aria-hidden="true" className="absolute inset-0"
        style={{
          display: "none", opacity: 0,
          background: "radial-gradient(ellipse at center, rgba(255,59,74,0) 45%, rgba(255,59,74,0.45) 78%, rgba(110,8,20,0.9) 100%)",
        }} />
      <div ref={flashRef} data-testid="nest-flash" data-mode="fade" aria-hidden="true" className="absolute inset-0"
        style={{
          display: "none", opacity: 0,
          background: "radial-gradient(ellipse at center, rgba(255,40,60,0) 55%, rgba(255,40,60,0.85) 100%)",
        }} />
      <div ref={bannerRef} data-testid="nest-banner" role="status"
        className="absolute inset-x-0 top-[22%] flex flex-col items-center gap-1 font-mono text-center"
        style={{ display: "none", color: NEST_RED, textShadow: "0 0 6px rgba(0,0,0,0.85)" }}>
        <div ref={titleRef} data-testid="nest-banner-title" className="text-sm sm:text-base font-bold tracking-[0.3em]" />
        <div ref={subRef} data-testid="nest-banner-sub" className="text-[10px] sm:text-[11px] tracking-[0.2em] text-white/80" />
      </div>
    </div>
  );
}
