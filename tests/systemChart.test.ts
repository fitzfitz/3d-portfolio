import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SystemChart from "../src/components/dom/SystemChart";
import type { BodyId } from "../src/data/bodyIds";
import { BODY_IDS } from "../src/data/bodyIds";

const html = renderToStaticMarkup(createElement(SystemChart, { charted: new Set<BodyId>(["ceres"]) }));

describe("SystemChart: says what kind of picture it is", () => {
  it("its accessible name says it is a snapshot of real ellipses with an inner-system inset", () => {
    const label = html.match(/aria-label="([^"]*)"/)?.[1] ?? "";
    expect(label).toMatch(/snapshot/i);
    expect(label).toMatch(/real orbits/i);
    expect(label).toMatch(/inset/i);
    expect(label).toContain("1 of 9 world orbits charted");
  });

  it("shows the orrery date in the corner and a caption", () => {
    expect(html).toMatch(/data-testid="system-chart-date"[^>]*>ORRERY \d{4}-\d{2}-\d{2}</);
    expect(html).toMatch(/<figcaption class="[^"]*\btext-\[10px\] text-white\/60\b[^"]*">/);
  });
});

describe("SystemChart: real ellipses", () => {
  it("draws one ellipse per body, solid only once charted", () => {
    expect(html.match(/data-testid="system-chart-orbit-[a-z]+"/g)).toHaveLength(9);
    for (const id of BODY_IDS) expect(html).toContain(`data-testid="system-chart-orbit-${id}"`);
    expect(html).toMatch(/data-testid="system-chart-orbit-ceres" data-charted="true"/);
    expect(html).toMatch(/data-testid="system-chart-orbit-mercury" data-charted="false"/);
  });

  it("the orbits are paths, not circles, and Mars's is visibly off-centre from the Sun", () => {
    const d = html.match(/data-testid="system-chart-orbit-mars"[^>]*? d="([^"]*)"/)?.[1] ?? html.match(/ d="([^"]*)"[^>]*data-testid="system-chart-orbit-mars"/)?.[1] ?? "";
    expect(d.startsWith("M")).toBe(true);
    const pts = [...d.matchAll(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(pts.length).toBeGreaterThan(40);
    const cx = (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2;
    const cy = (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2;
    expect(Math.hypot(cx, cy)).toBeGreaterThan(0.01); // the Sun (0,0) is at a focus, not the centre
  });

  it("has an inset, Sun to Jupiter's aphelion, that contains Mercury and not Saturn", () => {
    const inset = html.match(/<g[^>]*data-testid="system-chart-inset"[^>]*>([\s\S]*?)<\/g><\/svg>|<g[^>]*data-testid="system-chart-inset"[^>]*>([\s\S]*)/);
    expect(inset).not.toBeNull();
    const body = inset![1] ?? inset![2];
    expect(body).toContain('data-testid="system-chart-inset-dot-mercury"');
    expect(body).toContain('data-testid="system-chart-inset-dot-jupiter"');
    expect(body).not.toContain("inset-dot-saturn");
  });
});
