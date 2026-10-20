import { describe, it, expect, vi, beforeEach } from "vitest";
import { isCartographer } from "../src/utils/charting";
import { useSpaceStore, flight, selectSceneFrozen, loadBadges, loadShards, todayStamp } from "../src/store/spaceStore";
import { BODY_IDS } from "../src/data/bodyIds";
import { SURVEY_LINE, AURUM_LINE, chartLine } from "../src/utils/charting";
import { CHANGELOG } from "../src/data/changelog";
import { DESTINATIONS } from "../src/data/destinations";
import { PROBES } from "../src/data/probes";
import { spotPos } from "../src/utils/probes";
import { selectModalOpen } from "../src/store/spaceStore";

beforeEach(() => {
  useSpaceStore.setState({
    activeZone: null, isOrbitLocked: false, isOrbitCooldown: false,
    isWarping: false, isLowPerf: false, lowPerfManual: false,
    showClassicCV: false, isNearSpawn: true, isTeleporting: false, isMuted: false,
    cometNear: false,
    shardsCollected: [], broadcast: null, impactCount: 0, scanTarget: null, photoMode: false,
    reducedMotion: false, reducedMotionManual: false,
    fuelEmpty: false, sceneReady: false,
    visitedDossiers: [], jumpRequest: null, warmingUp: false, pendingLowPerf: null, worldEvent: null,
    badges: [], plumeColor: "stock", logbookOpen: false, changelogOpen: false, logbookLineAt: 0,
    charted: [], openDossier: null, dossierVia: null, relocation: null, probeNear: null, probeTip: null,
    probeSpots: { ruangrapi: 0, portfolio: 0, fuxx: 0 },
  });
});

describe("spaceStore", () => {
  it("the logbook and the changelog never stay open together", () => {
    const s = useSpaceStore.getState();
    s.setLogbookOpen(true);
    s.setChangelogOpen(true);
    expect(useSpaceStore.getState()).toMatchObject({ changelogOpen: true, logbookOpen: false });
    s.setLogbookOpen(true);
    expect(useSpaceStore.getState()).toMatchObject({ changelogOpen: false, logbookOpen: true });
  });

  it("markChangelogSeen stores the newest entry id", () => {
    useSpaceStore.setState({ changelogSeen: "old" });
    useSpaceStore.getState().markChangelogSeen();
    expect(useSpaceStore.getState().changelogSeen).toBe(CHANGELOG[0].id);
  });

  it("recordBadge records once, persists with the date and announces", async () => {
    const s = useSpaceStore.getState();
    s.recordBadge("slingshot");
    await Promise.resolve();
    const st = useSpaceStore.getState();
    expect(st.badges.map((b) => b.id)).toEqual(["slingshot"]);
    expect(st.badges[0].at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(st.broadcast).toMatchObject({ text: "LOGBOOK // SLINGSHOT EARNED — GOLD PLUME UNLOCKED. DOCK AT THE SHIPYARD [5]", silent: false });
  });

  it("recordBadge is a no-op once earned, and for derived or unknown ids", async () => {
    const s = useSpaceStore.getState();
    s.recordBadge("comet");
    await Promise.resolve();
    const id = useSpaceStore.getState().broadcast?.id;
    s.recordBadge("comet");
    s.recordBadge("fuxx");
    s.recordBadge("shards");
    s.recordBadge("nope");
    await Promise.resolve();
    expect(useSpaceStore.getState().badges).toHaveLength(1);
    expect(useSpaceStore.getState().broadcast?.id).toBe(id);
  });

  it("records the contact essential on the first dock at the portal", () => {
    useSpaceStore.setState({ activeZone: "contact" });
    useSpaceStore.getState().setOrbitLocked(true);
    expect(useSpaceStore.getState().badges.map((b) => b.id)).toEqual(["contact"]);
  });

  it("records the career essential on the first dock at the station, and it is not a planet dossier", () => {
    useSpaceStore.setState({ activeZone: "career" });
    useSpaceStore.getState().setOrbitLocked(true);
    expect(useSpaceStore.getState().badges.map((b) => b.id)).toEqual(["career"]);
    expect(useSpaceStore.getState().visitedDossiers).toEqual([]);
  });

  it("keeps a stored career badge (returning visitors who already docked)", () => {
    expect(loadBadges([{ id: "career", at: "2026-10-15" }])).toEqual([{ id: "career", at: "2026-10-15" }]);
  });

  it("loadBadges keeps known recordable ids, drops malformed rows and duplicates", () => {
    expect(loadBadges([{ id: "comet", at: "2026-10-13" }, { id: "comet", at: "2026-10-14" }, { id: "fuxx", at: "x" },
      { id: "nope", at: "2026-10-13" }, "junk", null, { id: "ring" }])).toEqual([{ id: "comet", at: "2026-10-13" }]);
    expect(loadBadges("not an array")).toEqual([]);
  });

  it("loadBadges drops a known badge whose date is not a YYYY-MM-DD stamp", () => {
    expect(loadBadges([{ id: "ring", at: "x" }, { id: "comet", at: "" }, { id: "ore", at: "13/10/2026" },
      { id: "ring", at: "2026-10-13" }])).toEqual([{ id: "ring", at: "2026-10-13" }]);
  });

  it("setPlumeColor only accepts unlocked colours", () => {
    const s = useSpaceStore.getState();
    s.setPlumeColor("slingshot");
    expect(useSpaceStore.getState().plumeColor).toBe("stock");
    s.recordBadge("slingshot");
    s.setPlumeColor("slingshot");
    expect(useSpaceStore.getState().plumeColor).toBe("slingshot");
    s.setPlumeColor("nope");
    expect(useSpaceStore.getState().plumeColor).toBe("slingshot");
  });

  it("a badge line waits for a fresh broadcast (scan report, lap time) to be read", async () => {
    vi.useFakeTimers();
    const s = useSpaceStore.getState();
    s.sendBroadcast("SCAN REPORT // COMET_VISITOR");
    s.recordBadge("comet");
    await Promise.resolve();
    expect(useSpaceStore.getState().badges.map((b) => b.id)).toEqual(["comet"]); // recorded at once
    expect(useSpaceStore.getState().broadcast?.text).toBe("SCAN REPORT // COMET_VISITOR");
    vi.advanceTimersByTime(4500);
    expect(useSpaceStore.getState().broadcast?.text).toMatch(/COMET CHASER EARNED/);
    vi.useRealTimers();
  });

  it("a badge line also waits for a payoff sent after it in the same frame (lap time)", async () => {
    vi.useFakeTimers();
    const s = useSpaceStore.getState();
    s.recordBadge("ring");
    s.sendBroadcast("LAP 0:42 // UNDER PAR");
    await Promise.resolve();
    expect(useSpaceStore.getState().broadcast?.text).toBe("LAP 0:42 // UNDER PAR");
    vi.advanceTimersByTime(4500);
    expect(useSpaceStore.getState().broadcast?.text).toMatch(/RING RUNNER EARNED/);
    vi.useRealTimers();
  });

  // Rulings R12/R12b: the next-stop hint is queued through announceLogbook
  // right after the last probe's PROBE RELOCATING line, so both are read.
  it("a line queued just after a fresh broadcast leaves it readable, then goes out audible", async () => {
    vi.useFakeTimers();
    const s = useSpaceStore.getState();
    s.sendBroadcast("PROBE RELOCATING // FUXX SIGNAL REACQUIRED BEARING 298 AT 418 U");
    s.announceLogbook("ALL 3 DOSSIERS READ // NEXT STOP: THE CAREER STATION — PRESS 4 TO JUMP THERE");
    await Promise.resolve();
    vi.advanceTimersByTime(4400);
    expect(useSpaceStore.getState().broadcast?.text).toMatch(/^PROBE RELOCATING/);
    vi.advanceTimersByTime(100);
    const b = useSpaceStore.getState().broadcast;
    expect(b?.text).toMatch(/^ALL 3 DOSSIERS READ/);
    expect(b?.silent).toBe(false);
    vi.useRealTimers();
  });

  it("logbook lines queue one after another instead of cutting each other off", async () => {
    vi.useFakeTimers();
    const s = useSpaceStore.getState();
    s.announceLogbook("FIRST");
    s.announceLogbook("SECOND");
    await Promise.resolve();
    expect(useSpaceStore.getState().broadcast?.text).toBe("FIRST");
    vi.advanceTimersByTime(4500);
    expect(useSpaceStore.getState().broadcast?.text).toBe("SECOND");
    vi.useRealTimers();
  });

  it("a queued logbook line waits again if another line went out meanwhile", async () => {
    vi.useFakeTimers();
    const s = useSpaceStore.getState();
    s.sendBroadcast("LAP 0:42");
    s.recordBadge("ring");
    await Promise.resolve();
    vi.advanceTimersByTime(4000);
    s.sendBroadcast("TIME TRIAL ABORTED");
    vi.advanceTimersByTime(600); // the badge's slot arrives
    expect(useSpaceStore.getState().broadcast?.text).toBe("TIME TRIAL ABORTED");
    vi.advanceTimersByTime(4500);
    expect(useSpaceStore.getState().broadcast?.text).toMatch(/RING RUNNER EARNED/);
    vi.useRealTimers();
  });

  it("loadShards keeps unique valid shard indices only", () => {
    expect(loadShards(null)).toEqual([]);
    expect(loadShards("abc")).toEqual([]);
    expect(loadShards([1, 1, 99, -1, "2", 1.5, 3])).toEqual([1, 3]);
  });

  it("todayStamp formats the local date", () => {
    expect(todayStamp(new Date(2026, 9, 3))).toBe("2026-10-03");
  });

  it("sendBroadcast marks lines silent only when asked", () => {
    const s = useSpaceStore.getState();
    s.sendBroadcast("SCAN REPORT");
    expect(useSpaceStore.getState().broadcast).toMatchObject({ text: "SCAN REPORT", silent: false });
    s.sendBroadcast("HAIL", { silent: true });
    expect(useSpaceStore.getState().broadcast).toMatchObject({ text: "HAIL", silent: true });
  });

  it("breakOrbit clears lock+zone and runs an 1800ms cooldown", () => {
    vi.useFakeTimers();
    useSpaceStore.setState({ isOrbitLocked: true, activeZone: "ruangrapi" });
    useSpaceStore.getState().breakOrbit();
    expect(useSpaceStore.getState().isOrbitLocked).toBe(false);
    expect(useSpaceStore.getState().activeZone).toBe(null);
    expect(useSpaceStore.getState().isOrbitCooldown).toBe(true);
    vi.advanceTimersByTime(1800);
    expect(useSpaceStore.getState().isOrbitCooldown).toBe(false);
    vi.useRealTimers();
  });

  it("setActiveZone does not notify subscribers for identical values", () => {
    const spy = vi.fn();
    const unsub = useSpaceStore.subscribe(spy);
    useSpaceStore.getState().setActiveZone(null); // already null
    expect(spy).not.toHaveBeenCalled();
    useSpaceStore.getState().setActiveZone("portfolio");
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("manual setLowPerf marks lowPerfManual so auto-degrade can defer", () => {
    useSpaceStore.getState().setLowPerf(true, true);
    expect(useSpaceStore.getState().lowPerfManual).toBe(true);
    useSpaceStore.getState().setLowPerf(false, false);
    expect(useSpaceStore.getState().isLowPerf).toBe(false);
    expect(useSpaceStore.getState().lowPerfManual).toBe(true); // sticky
  });

  // A tier switch mid-warm-up unmounts the full-detail objects, disposing
  // materials three's compileAsync is still polling: its poll throws
  // ("reading 'isReady'") and ShaderWarmup waits out its 8s cap. Reproduced
  // with an instrumented production build: the decline landed ~300ms into
  // warm-up and the scene came up ~5s late.
  it("defers a low-perf switch requested during warm-up until warm-up ends", () => {
    const s = useSpaceStore.getState();
    s.setWarmingUp(true);
    s.setLowPerf(true);
    expect(useSpaceStore.getState().isLowPerf).toBe(false);
    useSpaceStore.getState().setWarmingUp(false);
    expect(useSpaceStore.getState().isLowPerf).toBe(true);
  });

  it("applies the manual lock at once, even during warm-up", () => {
    useSpaceStore.getState().setWarmingUp(true);
    useSpaceStore.getState().setLowPerf(false, true);
    expect(useSpaceStore.getState().lowPerfManual).toBe(true);
  });

  it("lets the latest request during warm-up win", () => {
    const s = useSpaceStore.getState();
    s.setWarmingUp(true);
    s.setLowPerf(true);
    s.setLowPerf(false);
    useSpaceStore.getState().setWarmingUp(false);
    expect(useSpaceStore.getState().isLowPerf).toBe(false);
  });

  it("flight is a stable mutable object", () => {
    flight.x = 42;
    expect(flight.x).toBe(42);
    flight.x = 0;
  });

  it("breakOrbit called twice within cooldown cancels first timer and extends cooldown", () => {
    vi.useFakeTimers();
    useSpaceStore.getState().breakOrbit();
    expect(useSpaceStore.getState().isOrbitCooldown).toBe(true);
    vi.advanceTimersByTime(1000);
    useSpaceStore.getState().breakOrbit(); // called again 1000ms later
    vi.advanceTimersByTime(800); // now 1800ms from FIRST call
    expect(useSpaceStore.getState().isOrbitCooldown).toBe(true); // should still be true (pending second timer)
    vi.advanceTimersByTime(1000); // now 1800ms from SECOND call
    expect(useSpaceStore.getState().isOrbitCooldown).toBe(false);
    vi.useRealTimers();
  });

  it("triggerTeleportFlash called twice cancels first timer and extends flash duration", () => {
    vi.useFakeTimers();
    useSpaceStore.getState().triggerTeleportFlash();
    expect(useSpaceStore.getState().isTeleporting).toBe(true);
    vi.advanceTimersByTime(200);
    useSpaceStore.getState().triggerTeleportFlash(); // called again 200ms later
    vi.advanceTimersByTime(180); // now 380ms from FIRST call
    expect(useSpaceStore.getState().isTeleporting).toBe(true); // should still be true (pending second timer)
    vi.advanceTimersByTime(200); // now 380ms from SECOND call
    expect(useSpaceStore.getState().isTeleporting).toBe(false);
    vi.useRealTimers();
  });

  it("setMuted persists to localStorage", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    useSpaceStore.getState().setMuted(true);
    expect(useSpaceStore.getState().isMuted).toBe(true);
    expect(store["fitz-sound-muted"]).toBe("1");
    useSpaceStore.getState().setMuted(false);
    expect(store["fitz-sound-muted"]).toBe("0");
    vi.unstubAllGlobals();
  });

  it("setCometNear does not notify subscribers for identical values", () => {
    const spy = vi.fn();
    const unsub = useSpaceStore.subscribe(spy);
    useSpaceStore.getState().setCometNear(false); // already false
    expect(spy).not.toHaveBeenCalled();
    useSpaceStore.getState().setCometNear(true);
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("collectShard is idempotent and persists", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    useSpaceStore.getState().collectShard(3);
    useSpaceStore.getState().collectShard(3);
    expect(useSpaceStore.getState().shardsCollected).toEqual([3]);
    expect(JSON.parse(store["fitz-shards"])).toEqual([3]);
    vi.unstubAllGlobals();
  });
  it("sendBroadcast retriggers identical text via incrementing id", () => {
    useSpaceStore.getState().sendBroadcast("HELLO");
    const first = useSpaceStore.getState().broadcast;
    useSpaceStore.getState().sendBroadcast("HELLO");
    const second = useSpaceStore.getState().broadcast;
    expect(first!.text).toBe("HELLO");
    expect(second!.id).toBeGreaterThan(first!.id);
  });
  it("bumpImpact increments", () => {
    useSpaceStore.getState().bumpImpact();
    expect(useSpaceStore.getState().impactCount).toBe(1);
  });

  // Guards the Critical found late in Task 6: showClassicCV is the only thing
  // that unmounts GlobalCanvas, and without this coupling, isOrbitLocked
  // survives that unmount untouched — a visitor who opened a dossier, then
  // round-tripped through classic CV, got a freshly-mounted Canvas whose very
  // first render already had sceneFrozen=true, with no frozen->unfrozen edge
  // for GlobalCanvas's invalidate() effect to ever fire on: a blank canvas,
  // not a stale frame. Previously covered only by transition.probe.mjs
  // (the classic-CV round trip section) — the most expensive possible place
  // to assert what is otherwise a pure store invariant.
  it("setShowClassicCV(true) breaks any held orbit lock", () => {
    useSpaceStore.setState({ isOrbitLocked: true, activeZone: "ruangrapi" });
    useSpaceStore.getState().setShowClassicCV(true);
    expect(useSpaceStore.getState().isOrbitLocked).toBe(false);
    expect(useSpaceStore.getState().activeZone).toBe(null);
    expect(useSpaceStore.getState().showClassicCV).toBe(true);
  });

  it("setShowClassicCV(false) does not touch an existing orbit lock", () => {
    useSpaceStore.setState({ isOrbitLocked: true, activeZone: "ruangrapi", showClassicCV: true });
    useSpaceStore.getState().setShowClassicCV(false);
    expect(useSpaceStore.getState().isOrbitLocked).toBe(true);
    expect(useSpaceStore.getState().activeZone).toBe("ruangrapi");
    expect(useSpaceStore.getState().showClassicCV).toBe(false);
  });
});

describe("selectSceneFrozen", () => {
  const base = {
    isOrbitLocked: false, openDossier: null, activeZone: null, photoMode: false, showClassicCV: false,
  } as Parameters<typeof selectSceneFrozen>[0];

  it("is false during ordinary flight", () => {
    expect(selectSceneFrozen(base)).toBe(false);
  });

  it("is true while the dossier modal is open", () => {
    expect(selectSceneFrozen({ ...base, isOrbitLocked: true, activeZone: "contact" })).toBe(true);
  });

  it("is false in photo mode, which needs live frames for OrbitControls", () => {
    expect(selectSceneFrozen({ ...base, photoMode: true })).toBe(false);
  });

  it("is false when merely near a planet but not locked", () => {
    expect(selectSceneFrozen({ ...base, activeZone: "ruangrapi" })).toBe(false);
  });
});

// The reduced-motion flag is seeded from localStorage at module load, before
// any React effect runs. If the ambient clock weren't synced at that same
// moment, a reload with reduced motion stored ON would say "reduced motion is
// on" while the decorative clock kept advancing until the visitor toggled the
// HUD button twice — the sync hook (which skips its own call when the choice
// is manual) never gets a chance to close it. vi.resetModules() + a dynamic
// import reproduces a genuine cold module load, same pattern as the "cold
// start" case in tests/ambientTime.test.ts.
describe("reducedMotion / ambientTime sync at module load", () => {
  it("freezes the ambient clock immediately when reduced motion is stored on", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k === "fitz-reduced-motion" ? "1" : null),
      setItem: () => {},
    });
    const ambient = await import("../src/utils/ambientTime");
    const freshStore = await import("../src/store/spaceStore");
    expect(freshStore.useSpaceStore.getState().reducedMotion).toBe(true);
    expect(ambient.ambientTime(5)).toBe(0); // seeds the cold-start clock
    expect(ambient.ambientTime(6)).toBe(0); // frozen: would be 1 if still enabled
    vi.unstubAllGlobals();
  });
});

describe("warp state on scene freeze", () => {
  // The dossier freezes the frame loop, so the ship can't clear isWarping
  // itself: a lock entered mid-boost left the warp drone and HUD "ACTIVE".
  it("orbit lock clears isWarping", () => {
    useSpaceStore.setState({ isWarping: true });
    useSpaceStore.getState().setOrbitLocked(true);
    expect(useSpaceStore.getState().isWarping).toBe(false);
  });

  it("entering the classic résumé clears isWarping", () => {
    useSpaceStore.setState({ isWarping: true });
    useSpaceStore.getState().setShowClassicCV(true);
    expect(useSpaceStore.getState().isWarping).toBe(false);
  });
});

describe("sceneReady", () => {
  it("notifies only on change", () => {
    const spy = vi.fn();
    const unsub = useSpaceStore.subscribe((s) => s.sceneReady, spy);
    useSpaceStore.getState().setSceneReady(true);
    useSpaceStore.getState().setSceneReady(true);
    expect(useSpaceStore.getState().sceneReady).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    useSpaceStore.getState().setSceneReady(false);
    expect(useSpaceStore.getState().sceneReady).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
    unsub();
  });
});

describe("hasWebGL", () => {
  it("is false when no context can be created", async () => {
    const { hasWebGL } = await import("../src/store/spaceStore");
    const doc = { createElement: () => ({ getContext: () => null }) };
    expect(hasWebGL(doc as unknown as Document)).toBe(false);
  });
  it("is true when a webgl2 context is available", async () => {
    const { hasWebGL } = await import("../src/store/spaceStore");
    const doc = { createElement: () => ({ getContext: (k: string) => (k === "webgl2" ? {} : null) }) };
    expect(hasWebGL(doc as unknown as Document)).toBe(true);
  });
  it("never throws", async () => {
    const { hasWebGL } = await import("../src/store/spaceStore");
    const doc = { createElement: () => { throw new Error("blocked"); } };
    expect(hasWebGL(doc as unknown as Document)).toBe(false);
  });
});

describe("probe HUD fields", () => {
  it("setProbeTip writes only on a change", () => {
    const seen: unknown[] = [];
    const unsub = useSpaceStore.subscribe((s) => seen.push(s.probeTip));
    const st = useSpaceStore.getState();
    st.setProbeTip("closer"); st.setProbeTip("closer"); st.setProbeTip("grab"); st.setProbeTip("grab"); st.setProbeTip(null);
    unsub();
    expect(seen).toEqual(["closer", "grab", null]);
  });
});

describe("dossier progress", () => {
  it("openProjectDossier records the visit once and persists fitz-dossiers", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem });
    useSpaceStore.setState({ isWarping: true });
    useSpaceStore.getState().openProjectDossier("ruangrapi", "logbook");
    expect(useSpaceStore.getState()).toMatchObject({ openDossier: "ruangrapi", dossierVia: "logbook", visitedDossiers: ["ruangrapi"], isWarping: false });
    expect(setItem).toHaveBeenCalledWith("fitz-dossiers", JSON.stringify(["ruangrapi"]));
    useSpaceStore.getState().closeDossier();
    useSpaceStore.getState().openProjectDossier("ruangrapi", "logbook");
    expect(useSpaceStore.getState().visitedDossiers).toEqual(["ruangrapi"]);
    vi.unstubAllGlobals();
  });

  it("openProjectDossier while one is open is ignored", () => {
    useSpaceStore.getState().openProjectDossier("ruangrapi", "probe");
    useSpaceStore.getState().openProjectDossier("fuxx", "logbook");
    expect(useSpaceStore.getState()).toMatchObject({ openDossier: "ruangrapi", dossierVia: "probe", visitedDossiers: ["ruangrapi"] });
  });

  it("unknown id is ignored", () => {
    useSpaceStore.getState().openProjectDossier("contact", "probe");
    useSpaceStore.getState().openProjectDossier("nowhere", "logbook");
    expect(useSpaceStore.getState()).toMatchObject({ openDossier: null, visitedDossiers: [] });
  });

  it("closeDossier via probe advances and persists fitz-probes before relocation is set", () => {
    const events: string[] = [];
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: (k: string, v: string) => { if (k === "fitz-probes") events.push(`persist:${v}`); },
    });
    const unsub = useSpaceStore.subscribe((st, prev) => { if (st.relocation !== prev.relocation) events.push("relocation"); });
    useSpaceStore.getState().openProjectDossier("portfolio", "probe");
    useSpaceStore.getState().closeDossier();
    unsub();
    vi.unstubAllGlobals();
    const st = useSpaceStore.getState();
    expect(st).toMatchObject({ openDossier: null, dossierVia: null, relocation: { id: "portfolio", seq: 1 } });
    expect(st.probeSpots).toEqual({ ruangrapi: 0, portfolio: 1, fuxx: 0 });
    expect(events).toEqual([`persist:${JSON.stringify({ ruangrapi: 0, portfolio: 1, fuxx: 0 })}`, "relocation"]);
  });

  it("closeDossier via logbook leaves probeSpots and relocation untouched", () => {
    useSpaceStore.getState().openProjectDossier("fuxx", "logbook");
    useSpaceStore.getState().closeDossier();
    expect(useSpaceStore.getState()).toMatchObject({ openDossier: null, dossierVia: null, relocation: null, probeSpots: { ruangrapi: 0, portfolio: 0, fuxx: 0 } });
  });

  it("setShowClassicCV(true) closes an open dossier and the scene is not frozen afterwards", () => {
    useSpaceStore.getState().openProjectDossier("fuxx", "logbook");
    useSpaceStore.getState().setShowClassicCV(true);
    useSpaceStore.getState().setShowClassicCV(false);
    expect(useSpaceStore.getState().openDossier).toBe(null);
    expect(selectSceneFrozen(useSpaceStore.getState())).toBe(false);
  });

  it("setShowClassicCV(true) with a probe-origin dossier advances that probe's spot, persists fitz-probes and sets relocation", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem });
    useSpaceStore.getState().openProjectDossier("fuxx", "probe");
    useSpaceStore.getState().setShowClassicCV(true);
    vi.unstubAllGlobals();
    const st = useSpaceStore.getState();
    expect(st).toMatchObject({ openDossier: null, dossierVia: null, relocation: { id: "fuxx", seq: 1 } });
    expect(st.probeSpots).toEqual({ ruangrapi: 0, portfolio: 0, fuxx: 1 });
    expect(setItem).toHaveBeenCalledWith("fitz-probes", JSON.stringify({ ruangrapi: 0, portfolio: 0, fuxx: 1 }));
  });

  it("a reload after close starts the probe at its new spot", async () => {
    const stored: Record<string, string> = {};
    vi.stubGlobal("localStorage", { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => { stored[k] = v; } });
    useSpaceStore.getState().openProjectDossier("ruangrapi", "probe");
    useSpaceStore.getState().closeDossier();
    vi.resetModules();
    const fresh = await import("../src/store/probeState");
    const freshStore = await import("../src/store/spaceStore");
    vi.unstubAllGlobals();
    const def = PROBES.find((p) => p.id === "ruangrapi")!;
    const [x, y, z] = spotPos(def, 1);
    expect(fresh.probePos.ruangrapi).toEqual({ x, y, z });
    expect(freshStore.useSpaceStore.getState().probeSpots.ruangrapi).toBe(1);
    expect(fresh.probeRelocating.ruangrapi).toBe(false);
  });

  it("fitz-dossiers with stale ids keeps only project ids", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", { getItem: (k: string) => (k === "fitz-dossiers" ? JSON.stringify(["saas", "contact", "fuxx", "mars"]) : null), setItem: () => {} });
    const fresh = await import("../src/store/spaceStore");
    vi.unstubAllGlobals();
    expect(fresh.useSpaceStore.getState().visitedDossiers).toEqual(["fuxx"]);
  });

  it("selectSceneFrozen: dossier open → frozen; photo mode → not frozen; orbit lock still freezes", () => {
    const base = { isOrbitLocked: false, openDossier: null, photoMode: false };
    expect(selectSceneFrozen(base)).toBe(false);
    expect(selectSceneFrozen({ ...base, openDossier: "fuxx" })).toBe(true);
    expect(selectSceneFrozen({ ...base, openDossier: "fuxx", photoMode: true })).toBe(false);
    expect(selectSceneFrozen({ ...base, isOrbitLocked: true })).toBe(true);
    expect(selectModalOpen(base)).toBe(false);
    expect(selectModalOpen({ ...base, openDossier: "fuxx" })).toBe(true);
  });

  it("requestJump accepts probe ids and destinations, rejects world ids", () => {
    for (const id of ["ruangrapi", "portfolio", "fuxx", "career"]) {
      useSpaceStore.setState({ jumpRequest: null });
      useSpaceStore.getState().requestJump(id);
      expect(useSpaceStore.getState().jumpRequest?.id).toBe(id);
    }
    useSpaceStore.setState({ jumpRequest: null });
    useSpaceStore.getState().requestJump("mars");
    expect(useSpaceStore.getState().jumpRequest).toBe(null);
  });

  it("the contact portal is not a dossier", () => {
    useSpaceStore.setState({ activeZone: "contact" });
    useSpaceStore.getState().setOrbitLocked(true);
    expect(useSpaceStore.getState().visitedDossiers).toEqual([]);
  });
});

describe("requestJump", () => {
  it("accepts every destination in the table", () => {
    for (const d of DESTINATIONS) {
      useSpaceStore.getState().requestJump(d.id);
      expect(useSpaceStore.getState().jumpRequest?.id).toBe(d.id);
    }
  });

  it("issues a fresh request each time, even for the same target", () => {
    useSpaceStore.getState().requestJump("portfolio");
    const a = useSpaceStore.getState().jumpRequest;
    useSpaceStore.getState().requestJump("portfolio");
    const b = useSpaceStore.getState().jumpRequest;
    expect(a?.id).toBe("portfolio");
    expect(b?.seq).toBeGreaterThan(a!.seq);
  });

  it("ignores unknown targets", () => {
    useSpaceStore.getState().requestJump("nowhere");
    expect(useSpaceStore.getState().jumpRequest).toBe(null);
  });
});

describe("wantsResume", () => {
  it("recognises the résumé deep links", async () => {
    const { wantsResume } = await import("../src/store/spaceStore");
    for (const [search, hash] of [["?cv", ""], ["?resume", ""], ["?utm=x&cv=1", ""], ["", "#resume"], ["", "#CV"]]) {
      expect(wantsResume({ search, hash })).toBe(true);
    }
  });
  it("ignores everything else", async () => {
    const { wantsResume } = await import("../src/store/spaceStore");
    for (const [search, hash] of [["", ""], ["?cvx", ""], ["", "#projects"], ["?ref=cv", ""]]) {
      expect(wantsResume({ search, hash })).toBe(false);
    }
  });
});

describe("visitedDossiers at module load", () => {
  const loadWith = async (stored: string) => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k === "fitz-dossiers" ? stored : null),
      setItem: () => {},
    });
    const fresh = await import("../src/store/spaceStore");
    vi.unstubAllGlobals();
    return fresh.useSpaceStore.getState().visitedDossiers;
  };

  it("drops ids from an older content set", async () => {
    expect(await loadWith(JSON.stringify(["saas", "ruangrapi", "video"]))).toEqual(["ruangrapi"]);
  });

  it("survives a stored value that isn't an array", async () => {
    expect(await loadWith(JSON.stringify({ saas: true }))).toEqual([]);
    expect(await loadWith(JSON.stringify("fuxx"))).toEqual([]);
  });
});

describe("charting", () => {
  const original = useSpaceStore.getState();
  let stored: Record<string, string>;
  let announced: string[];
  let broadcast: string[];
  beforeEach(() => {
    stored = { "fitz-logbook": JSON.stringify([{ id: "comet", at: "2026-10-13" }]) };
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stored[k] ?? null,
      setItem: (k: string, v: string) => { stored[k] = v; },
    });
    announced = [];
    broadcast = [];
    useSpaceStore.setState({
      announceLogbook: (line) => { announced.push(line); },
      sendBroadcast: (text) => { broadcast.push(text); },
    });
    return () => {
      useSpaceStore.setState({ announceLogbook: original.announceLogbook, sendBroadcast: original.sendBroadcast });
      vi.unstubAllGlobals();
    };
  });

  it("chartWorld records once with today's date, persists to fitz-charted and announces once", () => {
    const s = useSpaceStore.getState();
    s.chartWorld("mercury");
    s.chartWorld("mercury");
    const st = useSpaceStore.getState();
    expect(st.charted).toEqual([{ id: "mercury", at: todayStamp() }]);
    expect(JSON.parse(stored["fitz-charted"])).toEqual([{ id: "mercury", at: todayStamp() }]);
    expect(announced).toEqual([chartLine("mercury", 1)]);
    expect(broadcast).toEqual([]);
  });

  it("rewrites a legacy fitz-charted in the new ids on the next charting write (§7)", () => {
    useSpaceStore.setState({ charted: [{ id: "neptune", at: "2026-10-18" }] }); // loaded from a stored w-blue
    useSpaceStore.getState().chartWorld("earth");
    expect(JSON.parse(stored["fitz-charted"])).toEqual([{ id: "neptune", at: "2026-10-18" }, { id: "earth", at: todayStamp() }]);
  });

  it("never touches fitz-logbook", () => {
    const before = stored["fitz-logbook"];
    for (const id of BODY_IDS) useSpaceStore.getState().chartWorld(id);
    expect(stored["fitz-logbook"]).toBe(before);
    expect(useSpaceStore.getState().badges).toEqual([]);
  });

  it("ignores ids that are not bodies", () => {
    // @ts-expect-error: a probe id is not a BodyId
    useSpaceStore.getState().chartWorld("fuxx");
    expect(useSpaceStore.getState().charted).toEqual([]);
    expect(announced).toEqual([]);
  });

  it("charting all nine queues nine charting lines, then exactly one survey line and the AURUM unlock, last", () => {
    for (const id of BODY_IDS) useSpaceStore.getState().chartWorld(id);
    for (const id of BODY_IDS) useSpaceStore.getState().chartWorld(id); // repeat scans
    expect(announced).toEqual([...BODY_IDS.map((id, i) => chartLine(id, i + 1)), SURVEY_LINE, AURUM_LINE]);
    expect(broadcast).toEqual([]);
  });
});

it("charting lines queue behind the scan report on the radio", async () => {
  // chartWorld persists to fitz-charted: stub storage as the charting describe
  // does, so the test never writes the real (or a missing) localStorage.
  const stored: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stored[k] ?? null,
    setItem: (k: string, v: string) => { stored[k] = v; },
  });
  vi.useFakeTimers();
  try {
    const s = useSpaceStore.getState();
    s.sendBroadcast("SCAN[MERCURY]");
    s.chartWorld("mercury");
    await Promise.resolve();
    expect(useSpaceStore.getState().broadcast?.text).toBe("SCAN[MERCURY]");
    vi.advanceTimersByTime(4500);
    expect(useSpaceStore.getState().broadcast?.text).toBe(chartLine("mercury", 1));
    expect(JSON.parse(stored["fitz-charted"])).toEqual([{ id: "mercury", at: todayStamp() }]);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

describe("charted at module load", () => {
  const loadWith = async (charted: string, extra: Record<string, string> = {}) => {
    vi.resetModules();
    const writes: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k === "fitz-charted" ? charted : extra[k] ?? null),
      setItem: (k: string, v: string) => { writes[k] = v; },
    });
    const fresh = await import("../src/store/spaceStore");
    vi.unstubAllGlobals();
    return { fresh, writes };
  };

  it("a returning visitor's charted bodies load", async () => {
    const { fresh } = await loadWith(JSON.stringify([{ id: "neptune", at: "2026-10-18" }]));
    expect(fresh.useSpaceStore.getState().charted).toEqual([{ id: "neptune", at: "2026-10-18" }]);
    expect(fresh.useSpaceStore.getState().legacyCartographer).toBe(false);
  });

  it("a returning visitor's legacy world ids load as their real bodies (§7)", async () => {
    const { fresh } = await loadWith(JSON.stringify([{ id: "w-blue", at: "2026-10-18" }, { id: "w-dwarf", at: "2026-10-19" }]));
    expect(fresh.useSpaceStore.getState().charted).toEqual([{ id: "neptune", at: "2026-10-18" }, { id: "ceres", at: "2026-10-19" }]);
    expect(fresh.useSpaceStore.getState().legacyCartographer).toBe(false);
  });

  it("the five legacy records + AURUM set the legacy flag once: cartographer, AURUM kept, 5/9", async () => {
    const legacy = ["w-rock", "w-ringed", "w-tilted", "w-blue", "w-dwarf"].map((id) => ({ id, at: "2026-10-18" }));
    const { fresh, writes } = await loadWith(JSON.stringify(legacy), { "fitz-plume": JSON.stringify("cartographer") });
    const st = fresh.useSpaceStore.getState();
    expect(writes["fitz-cartographer-legacy"]).toBeTruthy();
    expect(st.legacyCartographer).toBe(true);
    expect(isCartographer(st.charted, st.legacyCartographer)).toBe(true);
    expect(st.plumeColor).toBe("cartographer");
    expect(st.charted.map((c) => c.id)).toEqual(["mercury", "saturn", "uranus", "neptune", "ceres"]);
    expect(st.charted).toHaveLength(5);
  });

  it("the legacy flag is never cleared: a stored flag holds without the legacy records", async () => {
    const { fresh } = await loadWith("[]", { "fitz-cartographer-legacy": "1" });
    expect(fresh.useSpaceStore.getState().legacyCartographer).toBe(true);
  });

  it("seeds `bodies` with the nine body ids and nothing else", async () => {
    const { fresh } = await loadWith("[]");
    expect(Object.keys(fresh.bodies)).toEqual([...BODY_IDS]);
  });

  it("survives corrupt storage", async () => {
    const { fresh } = await loadWith("{not json");
    expect(fresh.useSpaceStore.getState().charted).toEqual([]);
    expect(fresh.useSpaceStore.getState().legacyCartographer).toBe(false);
  });
});
