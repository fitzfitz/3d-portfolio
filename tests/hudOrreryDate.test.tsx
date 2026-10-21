import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import HUDOverlay from "../src/components/layout/HUDOverlay";
import { ORRERY_TEST_JD, setOrreryEpochJd, formatOrreryDate, orreryJd } from "../src/utils/orreryClock";

describe("HUD orrery date", () => {
  it("shows ORRERY plus formatOrreryDate of the current orrery JD beside the Sun distance", () => {
    setOrreryEpochJd(ORRERY_TEST_JD);
    const html = renderToStaticMarkup(<HUDOverlay />);
    const m = /data-testid="hud-orrery-date"[^>]*>([^<]*(?:<!-- -->[^<]*)*)</.exec(html);
    expect(m).not.toBeNull();
    expect(m![1].replace(/<!-- -->/g, "")).toBe(` · ORRERY ${formatOrreryDate(orreryJd(0))}`);
    expect(formatOrreryDate(orreryJd(0))).toBe("2026-10-20");
    expect(html.indexOf("hud-sun-distance")).toBeLessThan(html.indexOf("hud-orrery-date"));
  });
});
