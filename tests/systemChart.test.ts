import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SystemChart from "../src/components/dom/SystemChart";
import type { WorldId } from "../src/data/worlds";

const html = renderToStaticMarkup(createElement(SystemChart, { charted: new Set<WorldId>(["w-dwarf"]) }));

describe("SystemChart: says what kind of picture it is", () => {
  it("its accessible name says it is a snapshot with the orbits drawn flattened", () => {
    const label = html.match(/aria-label="([^"]*)"/)?.[1] ?? "";
    expect(label).toMatch(/snapshot/i);
    expect(label).toMatch(/orbits drawn flattened/i);
    expect(label).toContain("1 of 5 world orbits charted");
  });

  it("shows a caption saying the same, in the panel's small-label style", () => {
    expect(html).toMatch(/<figcaption[^>]*>SNAPSHOT · ORBITS DRAWN FLATTENED<\/figcaption>/);
    expect(html).toMatch(/<figcaption class="[^"]*\btext-\[10px\] text-white\/60\b[^"]*">/);
  });
});
