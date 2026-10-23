import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CareerList from "../src/components/sections/CareerList";
import Career from "../src/components/sections/Career";
import CareerDossier from "../src/components/layout/CareerDossier";
import { BUNDLED_CAREER as career } from "../src/data/career";

/** React escapes these in markup. */
const escapeHtml = (s: string) => s
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const list = renderToStaticMarkup(createElement(CareerList));

describe("CareerList", () => {
  it("lists every role newest first, with company, note, dates, type, place and summary", () => {
    let at = -1;
    for (const c of career) {
      const i = list.indexOf(`${escapeHtml(c.role)}</h3>`);
      expect(i, c.role).toBeGreaterThan(at);
      at = i;
      const texts = [c.company, c.employment, c.location, c.summary, `${c.start} – ${c.end ?? "Present"}`];
      if (c.note) texts.push(`(${c.note})`);
      for (const t of texts) expect(list, t).toContain(escapeHtml(t));
    }
  });

  it("is exactly what the résumé's Career section renders, so the two cannot drift", () => {
    expect(renderToStaticMarkup(createElement(Career))).toContain(list);
  });
});

describe("CareerDossier", () => {
  const html = renderToStaticMarkup(createElement(CareerDossier, { onClose: () => {} }));

  it("is a labelled modal dialog", () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="career-dossier-title"');
    expect(html).toContain('id="career-dossier-title"');
  });

  it("renders the shared career list", () => {
    expect(html).toContain(list);
  });

  it("has a close button that names Esc", () => {
    expect(html).toContain('aria-label="Close career dossier (Esc)"');
  });
});
