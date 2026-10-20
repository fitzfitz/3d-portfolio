export type DossierVia = "probe" | "logbook";

/** Badge and main-button copy: a probe is recovered and released; a logbook copy is just closed. */
export function dossierCopy(via: DossierVia): { badge: string; button: string } {
  return via === "probe"
    ? { badge: "PROBE_RECOVERED", button: "RELEASE_PROBE" }
    : { badge: "LOGBOOK_COPY", button: "CLOSE_DOSSIER" };
}
