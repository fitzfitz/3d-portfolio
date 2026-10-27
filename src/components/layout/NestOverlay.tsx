import { useEffect, useRef } from "react";
import { combat, flight, useSpaceStore } from "../../store/spaceStore";
import { NEST_CENTRE, NEST_RED } from "../../data/nest";
import { flashOpacity, hitMarkOpacity, nestBanner, nestHazeOpacity, type NestBannerText } from "../../utils/combat/nestHud";
import { MAX_EDGE_ARROWS, nestScreen } from "../../utils/combat/nestScreen";
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
 *
 * In the fight (spec 2026-10-27-nest-playable §3–4) it also draws the red
 * bracket reticle on the locked monster, the HIT marker after a strike (a
 * 0.25 s fade, or static under reduced motion) and up to 8 edge arrows
 * toward monsters off screen, all from `nestScreen` (NestDirector projects
 * them each frame). Each is out of display when unused and in a photo; a
 * shown one gets one transform, in whole pixels, so an unmoved one is not
 * rewritten.
 */
const RETICLE_EDGE = `2px solid ${NEST_RED}`;
/** The reticle's four corners (built once). */
const RETICLE_CORNERS = [
  { key: "tl", style: { left: 0, top: 0, borderLeft: RETICLE_EDGE, borderTop: RETICLE_EDGE } },
  { key: "tr", style: { right: 0, top: 0, borderRight: RETICLE_EDGE, borderTop: RETICLE_EDGE } },
  { key: "bl", style: { left: 0, bottom: 0, borderLeft: RETICLE_EDGE, borderBottom: RETICLE_EDGE } },
  { key: "br", style: { right: 0, bottom: 0, borderRight: RETICLE_EDGE, borderBottom: RETICLE_EDGE } },
] as const;

export default function NestOverlay() {
  const rootRef = useRef<HTMLDivElement>(null);
  const hazeRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const lockRef = useRef<HTMLDivElement>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const arrowRefs = useRef<(HTMLDivElement | null)[]>([]);

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
      // The reticle, HIT and the arrows are HUD too: none in a photo.
      const sc = nestScreen;
      const lockOn = !s.photoMode && sc.lock.on;
      const hit = s.photoMode || !sc.hit.on ? 0 : hitMarkOpacity(now, nestScreen.hitAt, reduced);
      const arrows = s.photoMode ? 0 : sc.arrows.count;
      const on = haze > 0 || flash > 0 || text !== null || lockOn || hit > 0 || arrows > 0;
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
      setStyle(lockRef.current, "display", lockOn ? "" : "none");
      if (lockOn) {
        setStyle(lockRef.current, "transform", `translate(${Math.round(sc.lock.x) - 18}px, ${Math.round(sc.lock.y) - 18}px)`);
      }
      setStyle(hitRef.current, "display", hit > 0 ? "" : "none");
      if (hit > 0) {
        setStyle(hitRef.current, "opacity", hit.toFixed(3));
        setStyle(hitRef.current, "transform", `translate(${Math.round(sc.hit.x)}px, ${Math.round(sc.hit.y)}px) translate(-50%, -34px)`);
      }
      if (hitRef.current && hitRef.current.dataset.mode !== mode) hitRef.current.dataset.mode = mode;
      for (let i = 0; i < MAX_EDGE_ARROWS; i++) {
        const el = arrowRefs.current[i];
        setStyle(el, "display", i < arrows ? "" : "none");
        if (i < arrows) {
          const a = sc.arrows;
          setStyle(el, "transform",
            `translate(${Math.round(a.x[i]) - 7}px, ${Math.round(a.y[i]) - 7}px) rotate(${a.angle[i].toFixed(2)}rad)`);
        }
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
      {/* The lock reticle: four red corner brackets, 36 px. */}
      <div ref={lockRef} data-testid="nest-lock" aria-hidden="true" className="absolute left-0 top-0"
        style={{ display: "none", width: 36, height: 36, filter: "drop-shadow(0 0 2px rgba(0,0,0,0.85))" }}>
        {RETICLE_CORNERS.map((c) => (
          <div key={c.key} className="absolute" style={{ width: 10, height: 10, ...c.style }} />
        ))}
      </div>
      <div ref={hitRef} data-testid="nest-hit" data-mode="fade" aria-hidden="true"
        className="absolute left-0 top-0 font-mono text-[10px] font-bold tracking-[0.25em]"
        style={{ display: "none", opacity: 0, color: NEST_RED, textShadow: "0 0 4px rgba(0,0,0,0.9)" }}>HIT</div>
      {Array.from({ length: MAX_EDGE_ARROWS }, (_, i) => (
        <div key={i} ref={(el) => { arrowRefs.current[i] = el; }} data-testid="nest-arrow" aria-hidden="true"
          className="absolute left-0 top-0"
          style={{
            display: "none", width: 14, height: 14, background: NEST_RED,
            clipPath: "polygon(0 0, 100% 50%, 0 100%, 30% 50%)",
          }} />
      ))}
    </div>
  );
}
