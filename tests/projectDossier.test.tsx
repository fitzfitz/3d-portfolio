import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ProjectDossier from "../src/components/layout/ProjectDossier";
import { dossierCopy } from "../src/components/layout/dossierCopy";
import { projects } from "../src/constants";
import { identity } from "../src/data/identity";

const noop = () => {};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

describe("dossierCopy", () => {
  it("reads PROBE_RECOVERED / RELEASE_PROBE from a probe", () => {
    expect(dossierCopy("probe")).toEqual({ badge: "PROBE_RECOVERED", button: "RELEASE_PROBE" });
  });
  it("reads LOGBOOK_COPY / CLOSE_DOSSIER from the logbook", () => {
    expect(dossierCopy("logbook")).toEqual({ badge: "LOGBOOK_COPY", button: "CLOSE_DOSSIER" });
  });
});

describe("ProjectDossier markup", () => {
  for (const p of projects) {
    it(`renders ${p.id}`, () => {
      const html = renderToStaticMarkup(<ProjectDossier project={p} via="probe" onClose={noop} />);
      expect(html).toContain(esc(p.title));
      expect(html).toContain(esc(p.short));
      expect(html).toContain(esc(p.description));
      for (const t of p.tech) expect(html).toContain(esc(t));
      expect(html).toContain(`href="${esc(p.repo ?? identity.github)}"`);
      expect(html).toContain(p.repo ? "VIEW_SOURCE" : "GITHUB_PROFILE");
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('aria-labelledby="dossier-title"');
      expect(html).toContain('id="dossier-title"');
      expect(html).toContain("Close dossier (Esc)");
    });
  }

  it("shows probe copy via probe and logbook copy via logbook", () => {
    const p = projects[0];
    const a = renderToStaticMarkup(<ProjectDossier project={p} via="probe" onClose={noop} />);
    expect(a).toContain("PROBE_RECOVERED");
    expect(a).toContain("RELEASE_PROBE");
    expect(a).not.toContain("ORBIT_LOCKED");
    const b = renderToStaticMarkup(<ProjectDossier project={p} via="logbook" onClose={noop} />);
    expect(b).toContain("LOGBOOK_COPY");
    expect(b).toContain("CLOSE_DOSSIER");
    expect(b).not.toContain("RELEASE_PROBE");
  });
});
