import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SystemChart from "../src/components/dom/SystemChart";
import type { BodyId } from "../src/data/bodyIds";
import { BODY_IDS } from "../src/data/bodyIds";
import { bodies } from "../src/store/spaceStore";
import { updateBodies } from "../src/utils/bodyPositions";
import { ORRERY_TEST_JD, setOrreryEpochJd } from "../src/utils/orreryClock";

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

describe("SystemChart: handedness", () => {
  setOrreryEpochJd(ORRERY_TEST_JD);
  const render = (t: number) => { updateBodies(t, bodies); return renderToStaticMarkup(createElement(SystemChart, { charted: new Set<BodyId>() })); };
  const dotOf = (h: string, id: string) => {
    const m = new RegExp(`data-testid="system-chart-dot-${id}" cx="(-?[\\d.]+)" cy="(-?[\\d.]+)"`).exec(h)!;
    return [Number(m[1]), Number(m[2])];
  };
  const pathOf = (h: string, id: string) => {
    const d = new RegExp(`data-testid="system-chart-orbit-${id}"[^>]*? d="([^"]*)"`).exec(h)![1];
    return [...d.matchAll(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  };
  const distToPath = (p: number[], pts: number[][]) => {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const dx = bx - ax, dy = by - ay;
      const u = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(p[0] - ax - u * dx, p[1] - ay - u * dy));
    }
    return best;
  };

  it("every body's dot lies on its own ellipse", () => {
    const h = render(20);
    for (const id of BODY_IDS) expect(distToPath(dotOf(h, id), pathOf(h, id)), id).toBeLessThan(0.5);
  });

  it("Earth's dot moves counter-clockwise on screen (SVG y points down)", () => {
    const a = dotOf(render(0), "earth"), b = dotOf(render(2), "earth");
    const ang = (p: number[]) => Math.atan2(-p[1], p[0]);
    let d = ang(b) - ang(a);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    expect(d).toBeGreaterThan(0);
  });
});
