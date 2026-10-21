import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import HUDOverlay from "../src/components/layout/HUDOverlay";
import { SHIP_WARP_SPEED } from "../src/constants";
import { CRUISE_MAX_FACTOR } from "../src/utils/cruise";
import { lightFractionLabel, speedKmS, LIGHT_KM_S } from "../src/utils/realUnits";

// Ruling R30: phones drop the light-speed fraction from the velocity line (it
// ran into the probe pickup tip); desktops must still show it (L39).
describe("HUD light-speed fraction", () => {
  it("is in the velocity line right after the speed, hidden only below the sm breakpoint", () => {
    const html = renderToStaticMarkup(<HUDOverlay />);
    const m = /<span([^>]*data-testid="hud-light-fraction"[^>]*)>([^<]*)</.exec(html);
    expect(m).not.toBeNull();
    expect(m![1]).toContain('class="hidden sm:inline"');
    expect(m![2]).toBe(" · 0.000% C");
    const vel = html.indexOf('data-testid="hud-velocity"');
    expect(vel).toBeGreaterThan(-1);
    expect(html.indexOf("VELOCITY: 0 KM/S", vel)).toBeLessThan(html.indexOf("hud-light-fraction"));
    expect(html.indexOf("hud-light-fraction")).toBeLessThan(html.indexOf("hud-sun-distance"));
  });
  it("reads the ship's speed as a percent of c: warp 0.225%, full cruise 2.703%", () => {
    expect(lightFractionLabel(SHIP_WARP_SPEED)).toBe(` · ${((speedKmS(SHIP_WARP_SPEED) / LIGHT_KM_S) * 100).toFixed(3)}% C`);
    expect(lightFractionLabel(SHIP_WARP_SPEED)).toBe(" · 0.225% C");
    expect(lightFractionLabel(SHIP_WARP_SPEED * CRUISE_MAX_FACTOR)).toBe(" · 2.703% C");
  });
});
