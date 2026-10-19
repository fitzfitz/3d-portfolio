import { describe, it, expect, afterEach } from "vitest";
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
    expect(html).toContain('aria-label="Re-open the RuangRapi dossier"');
    expect(html).not.toContain("Re-open the fuxx dossier");
    expect(html).not.toContain("Re-open the Flight-Sim CV dossier");
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
