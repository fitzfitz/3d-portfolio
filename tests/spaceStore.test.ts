import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSpaceStore, flight, selectSceneFrozen, loadBadges, todayStamp } from "../src/store/spaceStore";
import { CHANGELOG } from "../src/data/changelog";

beforeEach(() => {
  useSpaceStore.setState({
    activeZone: null, isOrbitLocked: false, isOrbitCooldown: false,
    isWarping: false, isLowPerf: false, lowPerfManual: false,
    showClassicCV: false, isNearSpawn: true, isTeleporting: false, isMuted: false,
    cometNear: false, altitudeWarn: false,
    shardsCollected: [], broadcast: null, impactCount: 0, scanTarget: null, photoMode: false,
    reducedMotion: false, reducedMotionManual: false,
    fuelEmpty: false, sceneReady: false,
    visitedDossiers: [], jumpRequest: null, warmingUp: false, pendingLowPerf: null, worldEvent: null,
    badges: [], plumeColor: "stock", logbookOpen: false, changelogOpen: false,
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

  it("recordBadge records once, persists with the date and announces", () => {
    const s = useSpaceStore.getState();
    s.recordBadge("slingshot");
    const st = useSpaceStore.getState();
    expect(st.badges.map((b) => b.id)).toEqual(["slingshot"]);
    expect(st.badges[0].at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(st.broadcast).toMatchObject({ text: "LOGBOOK // SLINGSHOT EARNED — GOLD PLUME UNLOCKED. PRESS L", silent: false });
  });

  it("recordBadge is a no-op once earned, and for derived or unknown ids", () => {
    const s = useSpaceStore.getState();
    s.recordBadge("comet");
    const id = useSpaceStore.getState().broadcast?.id;
    s.recordBadge("comet");
    s.recordBadge("fuxx");
    s.recordBadge("shards");
    s.recordBadge("nope");
    expect(useSpaceStore.getState().badges).toHaveLength(1);
    expect(useSpaceStore.getState().broadcast?.id).toBe(id);
  });

  it("records the contact essential on the first dock at the portal", () => {
    useSpaceStore.setState({ activeZone: "contact" });
    useSpaceStore.getState().setOrbitLocked(true);
    expect(useSpaceStore.getState().badges.map((b) => b.id)).toEqual(["contact"]);
  });

  it("loadBadges keeps known recordable ids, drops malformed rows and duplicates", () => {
    expect(loadBadges([{ id: "comet", at: "2026-10-13" }, { id: "comet", at: "2026-10-14" }, { id: "fuxx", at: "x" },
      { id: "nope", at: "2026-10-13" }, "junk", null, { id: "ring" }])).toEqual([{ id: "comet", at: "2026-10-13" }]);
    expect(loadBadges("not an array")).toEqual([]);
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

  it("a badge line waits for a fresh broadcast (scan report, lap time) to be read", () => {
    vi.useFakeTimers();
    const s = useSpaceStore.getState();
    s.sendBroadcast("SCAN REPORT // COMET_VISITOR");
    s.recordBadge("comet");
    expect(useSpaceStore.getState().badges.map((b) => b.id)).toEqual(["comet"]); // recorded at once
    expect(useSpaceStore.getState().broadcast?.text).toBe("SCAN REPORT // COMET_VISITOR");
    vi.advanceTimersByTime(4500);
    expect(useSpaceStore.getState().broadcast?.text).toMatch(/COMET CHASER EARNED/);
    vi.useRealTimers();
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

  it("setAltitudeWarn does not notify subscribers for identical values", () => {
    const spy = vi.fn();
    const unsub = useSpaceStore.subscribe(spy);
    useSpaceStore.getState().setAltitudeWarn(false);
    expect(spy).not.toHaveBeenCalled();
    useSpaceStore.getState().setAltitudeWarn(true);
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
    isOrbitLocked: false, activeZone: null, photoMode: false, showClassicCV: false,
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

describe("dossier progress", () => {
  it("locking onto a project planet records it once", () => {
    useSpaceStore.setState({ activeZone: "ruangrapi" });
    useSpaceStore.getState().setOrbitLocked(true);
    useSpaceStore.getState().setOrbitLocked(false);
    useSpaceStore.setState({ activeZone: "ruangrapi" });
    useSpaceStore.getState().setOrbitLocked(true);
    expect(useSpaceStore.getState().visitedDossiers).toEqual(["ruangrapi"]);
  });

  it("the contact portal is not a dossier", () => {
    useSpaceStore.setState({ activeZone: "contact" });
    useSpaceStore.getState().setOrbitLocked(true);
    expect(useSpaceStore.getState().visitedDossiers).toEqual([]);
  });
});

describe("requestJump", () => {
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
