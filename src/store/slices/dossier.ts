import { projects } from "../../constants";
import { PROBES } from "../../data/probes";
import { loadProbeSpots, nextSpot, type ProbeTip } from "../../utils/probes";
import { STORE_KEYS, safeGetJSON, safeSetJSON, loadVisitedDossiers as loadVisitedDossiersFor } from "../persist";
import type { SliceCreator } from "../spaceStore";

/** Project dossiers (the popup and the visits) and the probes that carry them. */
export interface DossierSlice {
  /** Project id whose dossier popup is open (independent of the orbit lock). */
  openDossier: string | null;
  dossierVia: "probe" | "logbook" | null;
  /** Project ids whose dossier has been opened (persisted). Drives DOSSIERS n/3. */
  visitedDossiers: string[];
  openProjectDossier: (id: string, via: "probe" | "logbook") => void;
  closeDossier: () => void;
  /** Each probe's current spot (0 = home, k = remote[k-1]); persisted as fitz-probes. */
  probeSpots: Record<string, number>;
  /** Set when a probe's dossier closes; consumed by ProjectProbes to play the burn. */
  relocation: { id: string; seq: number } | null;
  /** Nearest probe within PROBE_IN_RANGE (written by ProjectProbes, change-guarded). */
  probeNear: string | null;
  setProbeNear: (id: string | null) => void;
  /** The HUD pickup tip for probeNear: "grab" only when the beam would take a probe (ProjectProbes, change-guarded). */
  probeTip: ProbeTip;
  setProbeTip: (tip: ProbeTip) => void;
}

/** The current content's project ids, read at import (the boot gate settles the content first). */
const PROJECT_IDS: readonly string[] = projects.map((p) => p.id);

/** Stored dossier visits, current project ids only (the logbook slice reads them too, for the stored plume). */
export const loadVisitedDossiers = () => loadVisitedDossiersFor(PROJECT_IDS);

/** Cross-slice write: openProjectDossier clears the flight slice's isWarping in the same set. */
export const createDossierSlice: SliceCreator<DossierSlice> = (set, get) => ({
  openDossier: null,
  dossierVia: null,
  visitedDossiers: loadVisitedDossiers(),
  // Records the visit as setOrbitLocked once did. The popup freezes the frame
  // loop, so clear isWarping here too or the warp drone outlives the boost.
  openProjectDossier: (id, via) => {
    if (!PROJECT_IDS.includes(id) || get().openDossier !== null) return;
    const visited = get().visitedDossiers;
    if (visited.includes(id)) {
      set({ openDossier: id, dossierVia: via, isWarping: false });
      return;
    }
    const next = [...visited, id];
    safeSetJSON(STORE_KEYS.dossiers, next);
    set({ openDossier: id, dossierVia: via, isWarping: false, visitedDossiers: next });
  },
  closeDossier: () => {
    const { openDossier, dossierVia, probeSpots, relocation } = get();
    if (openDossier === null) return;
    const def = dossierVia === "probe" ? PROBES.find((p) => p.id === openDossier) : undefined;
    if (!def) { set({ openDossier: null, dossierVia: null }); return; }
    const spots = { ...probeSpots, [def.id]: nextSpot(def, probeSpots[def.id] ?? 0) };
    // Persist before the burn plays: a reload mid-animation must not undo it.
    safeSetJSON(STORE_KEYS.probes, spots);
    set({ openDossier: null, dossierVia: null, probeSpots: spots, relocation: { id: def.id, seq: (relocation?.seq ?? 0) + 1 } });
  },
  probeSpots: loadProbeSpots(safeGetJSON<unknown>(STORE_KEYS.probes, null)),
  relocation: null,
  probeNear: null,
  setProbeNear: (id) => { if (get().probeNear !== id) set({ probeNear: id }); },
  probeTip: null,
  setProbeTip: (tip) => { if (get().probeTip !== tip) set({ probeTip: tip }); },
});
