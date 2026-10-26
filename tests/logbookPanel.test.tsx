import { describe, it, expect, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LogbookPanel from "../src/components/layout/LogbookPanel";
import { reopenDossier } from "../src/components/layout/reopenDossier";
import { useSpaceStore } from "../src/store/spaceStore";

// zustand's hook reads getInitialState() (the same object, by reference) when
// server-rendering, so renderToStaticMarkup ignores setState(). Seed both.
const initialState = useSpaceStore.getInitialState();
const pristine = { ...initialState };
const seed = (patch: Partial<typeof pristine>) => { Object.assign(initialState, patch); useSpaceStore.setState(patch); };
afterEach(() => { Object.assign(initialState, pristine); useSpaceStore.setState(pristine, true); });

describe("LogbookPanel dossier re-open", () => {
  it("renders a re-open button for a done dossier only", () => {
    seed({ logbookOpen: true, showClassicCV: false, visitedDossiers: ["ruangrapi"] });
    const html = renderToStaticMarkup(<LogbookPanel />);
    // WCAG 2.5.3: the accessible name starts with the visible text, then adds the cue.
    const btn = html.match(/<button[^>]*data-testid="logbook-reopen-ruangrapi"[^>]*>(.*?)<\/button>/)?.[1] ?? "";
    expect(html).not.toContain("aria-label=\"Re-open");
    expect(btn.replace(/<[^>]+>/g, "")).toBe("Read the RuangRapi dossier, re-open");
    expect(btn.startsWith("Read the RuangRapi dossier")).toBe(true);
    expect(html).not.toContain("logbook-reopen-fuxx");
    expect(html).not.toContain("logbook-reopen-portfolio");
  });
  it("reopenDossier opens it with via logbook; closing leaves probeSpots alone", () => {
    seed({ visitedDossiers: ["fuxx"] });
    const spots = useSpaceStore.getState().probeSpots;
    reopenDossier("fuxx");
    expect(useSpaceStore.getState().openDossier).toBe("fuxx");
    expect(useSpaceStore.getState().dossierVia).toBe("logbook");
    useSpaceStore.getState().closeDossier();
    expect(useSpaceStore.getState().probeSpots).toEqual(spots);
    expect(useSpaceStore.getState().relocation).toBeNull();
  });
});

// Spec "The visitor setting: Show bottles": a switch next to live sky, only
// where bottles exist (the beacon API is configured).
describe("LogbookPanel Show bottles switch", () => {
  async function render(api: string, patch: Record<string, unknown> = {}) {
    vi.resetModules();
    vi.stubGlobal("localStorage", { getItem: (k: string) => (k === "fitz-beacon-api-dev" ? api : null), setItem() {} });
    const { useSpaceStore: store } = await import("../src/store/spaceStore");
    const { default: Panel } = await import("../src/components/layout/LogbookPanel");
    Object.assign(store.getInitialState(), { logbookOpen: true, showClassicCV: false, ...patch });
    return renderToStaticMarkup(<Panel />);
  }
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it("shows ON by default, as a switch described by its note", async () => {
    const html = await render("http://relay.test");
    const btn = html.match(/<button[^>]*data-testid="bottles-toggle"[^>]*>(.*?)<\/button>/);
    expect(btn?.[0]).toMatch(/role="switch"/);
    expect(btn?.[0]).toMatch(/aria-checked="true"/);
    expect(btn?.[1]).toBe("ON");
    expect(html).toContain('id="bottles-label"');
    expect(html).toMatch(/id="bottles-desc"[^>]*>[^<]*bottles/i);
  });
  it("reads OFF when the pilot hid them", async () => {
    const html = await render("http://relay.test", { showBottles: false });
    expect(html).toMatch(/data-testid="bottles-toggle"[^>]*>OFF</);
    expect(html).toMatch(/aria-checked="false"[^>]*data-testid="bottles-toggle"|data-testid="bottles-toggle"[^>]*aria-checked="false"/);
  });
  it("is absent without a beacon API", async () => {
    expect(await render("")).not.toContain("bottles-toggle");
  });
});
