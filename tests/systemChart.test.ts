import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SystemChart from "../src/components/dom/SystemChart";
import type { BodyId } from "../src/data/bodyIds";
import { BODY_IDS } from "../src/data/bodyIds";

const html = renderToStaticMarkup(createElement(SystemChart, { charted: new Set<BodyId>(["ceres"]) }));

describe("SystemChart: says what kind of picture it is", () => {
  it("its accessible name says it is a snapshot with the orbits drawn flattened", () => {
    const label = html.match(/aria-label="([^"]*)"/)?.[1] ?? "";
    expect(label).toMatch(/snapshot/i);
    expect(label).toMatch(/orbits drawn flattened/i);
    expect(label).toMatch(/square-root distances/i);
    expect(label).toContain("1 of 9 world orbits charted");
  });

  it("shows a caption saying the same, in the panel's small-label style", () => {
    expect(html).toMatch(/<figcaption[^>]*>SNAPSHOT · ORBITS DRAWN FLATTENED, SQUARE-ROOT DISTANCES<\/figcaption>/);
    expect(html).toMatch(/<figcaption class="[^"]*\btext-\[10px\] text-white\/60\b[^"]*">/);
  });
});

describe("SystemChart: the nine bodies", () => {
  it("draws one orbit per body, solid only once charted", () => {
    for (const id of BODY_IDS) expect(html).toContain(`data-testid="system-chart-orbit-${id}"`);
    expect(html).toMatch(/data-testid="system-chart-orbit-ceres" data-charted="true"/);
    expect(html).toMatch(/data-testid="system-chart-orbit-mercury" data-charted="false"/);
  });
});
