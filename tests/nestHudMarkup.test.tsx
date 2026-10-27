import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import HUDOverlay from "../src/components/layout/HUDOverlay";
import NestOverlay from "../src/components/layout/NestOverlay";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** The opening tag carrying a test id. */
const tag = (html: string, id: string) => new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`).exec(html)?.[0] ?? null;

describe("the HUD's hull row and wave line", () => {
  const html = renderToStaticMarkup(<HUDOverlay />);

  it("puts the HULL label and bar right under the fuel bar, hidden until the loop shows them", () => {
    const fuel = html.indexOf('data-testid="hud-fuel-bar"');
    const label = html.indexOf('data-testid="hud-hull-label"');
    const bar = html.indexOf('data-testid="hud-hull-bar"');
    expect(fuel).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(fuel);
    expect(bar).toBeGreaterThan(label);
    // Before the mining readout: the hull belongs with the fuel.
    expect(bar).toBeLessThan(html.indexOf('data-testid="hud-ore"'));
    expect(tag(html, "hud-hull-label")).toContain("display:none");
    expect(html).toContain(">HULL: 100%<");
  });

  it("has a wave line, empty and hidden at rest", () => {
    const t = tag(html, "hud-nest-wave");
    expect(t).not.toBeNull();
    expect(t).toContain("display:none");
  });

  it("writes the hull and wave in the telemetry loop, not through React state", () => {
    const s = src("src/components/layout/HUDOverlay.tsx");
    expect(s).toMatch(/hullShown\(combat\.inArea, hp\)/);
    expect(s).toMatch(/setStyle\(hullBarRef\.current, "width"/);
    expect(s).toMatch(/waveReadout\(st\.wave, st\.contacts\)/);
    // No store subscription for the per-frame parts.
    expect(s).not.toMatch(/useSpaceStore\(\(s\) => s\.(wave|contacts)\)/);
  });
});

describe("NestOverlay", () => {
  const html = renderToStaticMarkup(<NestOverlay />);

  it("is one full-window layer, out of display and click-through until something shows", () => {
    const root = tag(html, "nest-overlay");
    expect(root).not.toBeNull();
    expect(root).toContain("display:none");
    expect(root).toContain("pointer-events-none");
    expect(root).toContain("fixed inset-0");
    expect(html).not.toMatch(/backdrop/);
  });

  it("holds the haze, the hit flash and the banner, each hidden at rest", () => {
    for (const id of ["nest-haze", "nest-flash", "nest-banner"]) {
      const t = tag(html, id);
      expect(t, id).not.toBeNull();
      expect(t, id).toContain("display:none");
    }
    expect(tag(html, "nest-flash")).toContain('data-mode="fade"');
    expect(html).toContain('data-testid="nest-banner-title"');
    expect(html).toContain('data-testid="nest-banner-sub"');
  });

  it("drives them from one rAF loop with skip-unchanged writes, with no CSS animation", () => {
    const s = src("src/components/layout/NestOverlay.tsx");
    expect((s.match(/requestAnimationFrame\(tick\)/g) ?? []).length).toBe(2); // start + reschedule
    expect(s).toMatch(/nestHazeOpacity\(/);
    expect(s).toMatch(/flashOpacity\(now, combat\.flashAt, reduced\)/);
    expect(s).toMatch(/nestBanner\(now, combat, n\.phase, n\.phaseT, combat\.warm, banner\)/);
    expect(s).not.toMatch(/animate-|transition-|@keyframes/);
  });

  it("is mounted beside EdgeHaze, outside the classic résumé", () => {
    expect(src("src/App.tsx")).toMatch(/\{!showClassicCV && <EdgeHaze \/>\}\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?\{!showClassicCV && <NestOverlay \/>\}/);
  });
});

describe("the touch BEAM button", () => {
  it("reads FIRE in the fighting area through beamLabel, keeping its test id", () => {
    const s = src("src/components/layout/TouchControls.tsx");
    expect(s).toMatch(/const inNest = useSpaceStore\(\(s\) => s\.inNest\);/);
    expect(s).toMatch(/data-testid="touch-beam"[\s\S]*?\{beamLabel\(inNest\)\}/);
  });
});

describe("the sector list's Nest row", () => {
  it("jumps to the Nest after the destinations, with its key, red dot and centre", () => {
    const html = renderToStaticMarkup(<HUDOverlay />);
    const row = html.indexOf("THE_NEST ([-250, -390, 60])");
    expect(row).toBeGreaterThan(html.indexOf("PORTAL_SUN"));
    expect(html).toMatch(/title="Jump to the Nest \[\d+\]"/);
    expect(html.slice(0, row)).toMatch(/background-color:#ff3b4a[^>]*><\/span><span>$/);
  });
});

describe("the radar's Nest marker", () => {
  it("always places the Nest (nestRadarSpot); the zone ring and red monster blips only when it is not on the rim", () => {
    const s = src("src/components/layout/RadarMap.tsx");
    expect(s).toMatch(/NEST_RED/);
    expect(s).toMatch(/nestRadarSpot\(/);
    expect(s).toMatch(/NEST_ZONE_R \* scale/);
    expect(s).toMatch(/combat\.nest\.saucers/);
    // The ring and the blips sit inside `if (!spot.onRim) { … }` blocks.
    expect(s).toMatch(/if \(!\w+\.onRim\)\s*\{[^}]*NEST_ZONE_R \* scale[^}]*\}/);
    expect(s).toMatch(/if \(!\w+\.onRim\)\s*\{\s*drawMonsterBlips\(combat\.nest\.saucers\);\s*drawMonsterBlips\(combat\.nest\.tardigrades\);\s*\}/);
  });
});
