import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PlumePicker from "../src/components/layout/PlumePicker";
import HangarPanel from "../src/components/layout/HangarPanel";
import { PLUME_COLORS } from "../src/data/plumeColors";
import { WORLD_IDS } from "../src/data/worlds";

const none = { badges: [], visitedDossiers: [], shardsCollected: [] };

describe("PlumePicker", () => {
  it("offers every plume colour, stock unlocked and the rest locked with their badge named", () => {
    const html = renderToStaticMarkup(createElement(PlumePicker, { progress: none, plumeColor: "stock", onPick: () => {} }));
    for (const id of Object.keys(PLUME_COLORS)) expect(html).toContain(`data-testid="plume-${id}"`);
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/aria-checked="true"[^>]*data-testid="plume-stock"/);
    expect(html).toContain("GOLD plume, locked: earn Slingshot");
  });
  it("locks AURUM until all five worlds are charted", () => {
    const html = renderToStaticMarkup(createElement(PlumePicker, { progress: none, plumeColor: "stock", onPick: () => {} }));
    expect(html).toContain('aria-label="AURUM plume, locked: chart all 5 worlds"');
    expect(html).toContain('title="Chart all 5 worlds to unlock"');
    const charted = WORLD_IDS.map((id) => ({ id, at: "2026-10-19" }));
    const open = renderToStaticMarkup(createElement(PlumePicker, { progress: none, charted, plumeColor: "stock", onPick: () => {} }));
    expect(open).toContain('aria-label="AURUM plume"');
  });
  it("unlocks a colour once its badge is earned", () => {
    const progress = { ...none, badges: [{ id: "slingshot", at: "2026-10-16" }] };
    const html = renderToStaticMarkup(createElement(PlumePicker, { progress, plumeColor: "slingshot", onPick: () => {} }));
    expect(html).toContain('aria-label="GOLD plume"');
  });
});

describe("HangarPanel", () => {
  const html = renderToStaticMarkup(createElement(HangarPanel, { onClose: () => {} }));
  it("is a labelled modal dialog headed SHIPYARD // HANGAR", () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="hangar-title"');
    expect(html).toContain("SHIPYARD // HANGAR");
    expect(html).toContain('data-testid="hangar-panel"');
  });
  it("holds the plume picker and promises nothing for later", () => {
    expect(html).toContain('data-testid="plume-stock"');
    expect(html).not.toMatch(/hull paint|coming soon/i);
  });
});
