import { useSpaceStore } from "../../store/spaceStore";

/** Re-open a read dossier from the logbook; the panel then closes itself (a modal opened). */
export function reopenDossier(id: string): void {
  useSpaceStore.getState().openProjectDossier(id, "logbook");
}
