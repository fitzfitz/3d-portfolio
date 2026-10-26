import { describe, it, expect, vi, afterEach } from "vitest";
import * as storeModule from "../src/store/spaceStore";
// Type-only: `npm run build` type-checks tests/, so these pin the type exports too.
import type { FlightInput, CrystalSlot, WorldEventState, SpaceState } from "../src/store/spaceStore";
import { PROBES } from "../src/data/probes";
import { BODY_IDS } from "../src/data/bodyIds";
import { CHANGELOG } from "../src/data/changelog";

/**
 * API-shape and behaviour guard for the store split (spec
 * docs/superpowers/specs/2026-10-26-store-split-design.md). Pinned from the
 * single-file store before the split: the state keys, the module's named
 * exports, the import-time initial state and writes, and the exact sequence of
 * store notifications and storage writes for a scripted run of every action.
 */

type _TypeExports = [FlightInput, CrystalSlot, WorldEventState, SpaceState];
const _typesUsed: _TypeExports | null = null;

const STATE_KEYS = [
  "activeZone", "addOwnBeacon", "announceLogbook", "aurumTold", "badges", "beaconPickerOpen", "beacons",
  "breakOrbit", "broadcast", "bumpImpact", "canvasEpoch", "changelogOpen", "changelogSeen", "chartShoutAt",
  "chartWorld", "charted", "clearChartShout", "closeDossier", "collectShard", "cometNear", "dossierVia",
  "endWorldEvent", "fuelEmpty", "impactCount", "isLowPerf", "isMuted", "isNearSpawn", "isOrbitCooldown",
  "isOrbitLocked", "isTeleporting", "isWarping", "jumpRequest", "legacyCartographer", "liveSky", "liveSkySeen",
  "logbookLineAt", "logbookOpen", "lowPerfManual", "markChangelogSeen", "openDossier", "openProjectDossier",
  "ownBeacons", "padConnected", "pendingLowPerf", "photoMode", "plumeColor", "probeNear", "probeSpots",
  "probeTip", "race", "raceBest", "recordBadge", "reducedMotion", "reducedMotionManual", "relocation",
  "remountCanvas", "requestJump", "scanTarget", "sceneReady", "sendBroadcast", "setActiveZone",
  "setBeaconPickerOpen", "setBeacons", "setChangelogOpen", "setCometNear", "setFuelEmpty", "setLiveSky",
  "setLiveSkySeen", "setLogbookOpen", "setLowPerf", "setMuted", "setNearSpawn", "setOrbitLocked",
  "setPadConnected", "setPhotoMode", "setPlumeColor", "setProbeNear", "setProbeTip", "setRace", "setRaceBest",
  "setReducedMotion", "setScanTarget", "setSceneReady", "setShowClassicCV", "setWarmingUp", "setWarping",
  "shardsCollected", "showClassicCV", "startWorldEvent", "tellAurumOnce", "triggerTeleportFlash", "visitedDossiers",
  "warmingUp", "worldEvent",
];

const MODULE_EXPORTS = [
  "WEBGL_AVAILABLE", "bodies", "crystalSlots", "flight", "hasWebGL", "loadBadges", "loadShards",
  "selectModalOpen", "selectSceneFrozen", "todayStamp", "useSpaceStore", "wantsResume", "worldClock",
  "worldEventElapsed",
];

type Mod = typeof storeModule;

/** The newest changelog id changes with every PR: pin it by name, not value. */
const norm = (text: string) => text.replaceAll(CHANGELOG[0].id, "<newest changelog id>");
type State = ReturnType<Mod["useSpaceStore"]["getState"]>;

/** The non-function part of the state, for snapshots. */
function data(s: State): Record<string, unknown> {
  return JSON.parse(norm(JSON.stringify(Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v !== "function").sort(([a], [b]) => a.localeCompare(b))))));
}

/**
 * Imports a fresh store over a recording storage. `events` interleaves, in
 * order, each storage write, each ambient-clock switch and (once `watch` is
 * called) each store notification with the keys it changed.
 */
async function freshStore(seed: Record<string, string> = {}, win?: unknown) {
  vi.resetModules();
  const stored: Record<string, string> = { ...seed };
  const events: string[] = [];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stored[k] ?? null,
    setItem: (k: string, v: string) => { stored[k] = v; events.push(norm(`write ${k}=${v}`)); },
  });
  if (win) vi.stubGlobal("window", win);
  vi.doMock("../src/utils/ambientTime", async (orig) => ({
    ...(await orig<typeof import("../src/utils/ambientTime")>()),
    setAmbientEnabled: (v: boolean) => { events.push(`ambient ${v}`); },
  }));
  const m: Mod = await import("../src/store/spaceStore");
  const watch = () => m.useSpaceStore.subscribe((s, prev) => {
    const changed = Object.keys(s).filter((k) => s[k as keyof State] !== prev[k as keyof State]).sort();
    events.push(norm(`set ${changed.map((k) => `${k}=${JSON.stringify(s[k as keyof State])}`).join(" ")}`));
  });
  return { m, events, stored, watch };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock("../src/utils/ambientTime");
  vi.resetModules();
});

describe("store shape (split guard)", () => {
  it("keeps every state key and action name", () => {
    expect(Object.keys(storeModule.useSpaceStore.getState()).sort()).toEqual(STATE_KEYS);
    expect(_typesUsed).toBeNull();
  });

  it("keeps every runtime export of spaceStore.ts", () => {
    expect(Object.keys(storeModule).sort()).toEqual(MODULE_EXPORTS);
  });

  it("keeps the import-time state and writes with empty storage", async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 26, 12, 0, 0) });
    const { m, events } = await freshStore();
    expect(events).toMatchInlineSnapshot(`
      [
        "ambient true",
        "write fitz-changelog-seen="<newest changelog id>"",
      ]
    `);
    expect(data(m.useSpaceStore.getState())).toMatchInlineSnapshot(`
      {
        "activeZone": null,
        "aurumTold": false,
        "badges": [],
        "beaconPickerOpen": false,
        "beacons": [],
        "broadcast": null,
        "canvasEpoch": 0,
        "changelogOpen": false,
        "changelogSeen": "<newest changelog id>",
        "chartShoutAt": null,
        "charted": [],
        "cometNear": false,
        "dossierVia": null,
        "fuelEmpty": false,
        "impactCount": 0,
        "isLowPerf": false,
        "isMuted": false,
        "isNearSpawn": true,
        "isOrbitCooldown": false,
        "isOrbitLocked": false,
        "isTeleporting": false,
        "isWarping": false,
        "jumpRequest": null,
        "legacyCartographer": false,
        "liveSky": true,
        "liveSkySeen": false,
        "logbookLineAt": 0,
        "logbookOpen": false,
        "lowPerfManual": false,
        "openDossier": null,
        "ownBeacons": [],
        "padConnected": false,
        "pendingLowPerf": null,
        "photoMode": false,
        "plumeColor": "stock",
        "probeNear": null,
        "probeSpots": {
          "fuxx": 0,
          "portfolio": 0,
          "ruangrapi": 0,
        },
        "probeTip": null,
        "race": {
          "phase": "idle",
        },
        "raceBest": null,
        "reducedMotion": false,
        "reducedMotionManual": false,
        "relocation": null,
        "scanTarget": null,
        "sceneReady": false,
        "shardsCollected": [],
        "showClassicCV": true,
        "visitedDossiers": [],
        "warmingUp": false,
        "worldEvent": null,
      }
    `);
  });

  it("keeps the import-time state and writes with every key stored", async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 26, 12, 0, 0) });
    const legacy = ["w-rock", "w-ringed", "w-tilted", "w-blue", "w-dwarf"].map((id) => ({ id, at: "2025-01-02" }));
    const { m, events } = await freshStore({
      "fitz-sound-muted": "1",
      "fitz-reduced-motion": "0",
      "fitz-dossiers": JSON.stringify([PROBES[0].id, "saas"]),
      "fitz-logbook": JSON.stringify([{ id: "slingshot", at: "2026-01-02" }, { id: "nope", at: "2026-01-02" }]),
      "fitz-shards": JSON.stringify([0, 1, 1, 999]),
      "fitz-charted": JSON.stringify(legacy),
      "fitz-charted-shout": "1234",
      "fitz-aurum-told": "1",
      "fitz-plume": JSON.stringify("slingshot"),
      "fitz-changelog-seen": JSON.stringify("old-entry"),
      "fitz-live-sky": "0",
      "fitz-live-seen-2": "1",
      "fitz-race-best": "41.5",
      "fitz-own-beacons": JSON.stringify(["b1", 7, "b2"]),
      "fitz-probes": JSON.stringify({ [PROBES[0].id]: 1 }),
    }, { matchMedia: () => ({ matches: true }), location: { search: "?cv", hash: "" } });
    expect(events).toMatchInlineSnapshot(`
      [
        "write fitz-cartographer-legacy=1",
        "ambient true",
      ]
    `);
    expect(data(m.useSpaceStore.getState())).toMatchInlineSnapshot(`
      {
        "activeZone": null,
        "aurumTold": true,
        "badges": [
          {
            "at": "2026-01-02",
            "id": "slingshot",
          },
        ],
        "beaconPickerOpen": false,
        "beacons": [],
        "broadcast": null,
        "canvasEpoch": 0,
        "changelogOpen": false,
        "changelogSeen": "old-entry",
        "chartShoutAt": 1234,
        "charted": [
          {
            "at": "2025-01-02",
            "id": "mercury",
          },
          {
            "at": "2025-01-02",
            "id": "saturn",
          },
          {
            "at": "2025-01-02",
            "id": "uranus",
          },
          {
            "at": "2025-01-02",
            "id": "neptune",
          },
          {
            "at": "2025-01-02",
            "id": "ceres",
          },
        ],
        "cometNear": false,
        "dossierVia": null,
        "fuelEmpty": false,
        "impactCount": 0,
        "isLowPerf": false,
        "isMuted": true,
        "isNearSpawn": true,
        "isOrbitCooldown": false,
        "isOrbitLocked": false,
        "isTeleporting": false,
        "isWarping": false,
        "jumpRequest": null,
        "legacyCartographer": true,
        "liveSky": false,
        "liveSkySeen": true,
        "logbookLineAt": 0,
        "logbookOpen": false,
        "lowPerfManual": false,
        "openDossier": null,
        "ownBeacons": [
          "b1",
          "b2",
        ],
        "padConnected": false,
        "pendingLowPerf": null,
        "photoMode": false,
        "plumeColor": "slingshot",
        "probeNear": null,
        "probeSpots": {
          "fuxx": 0,
          "portfolio": 0,
          "ruangrapi": 1,
        },
        "probeTip": null,
        "race": {
          "phase": "idle",
        },
        "raceBest": 41.5,
        "reducedMotion": false,
        "reducedMotionManual": true,
        "relocation": null,
        "scanTarget": null,
        "sceneReady": false,
        "shardsCollected": [
          0,
          1,
        ],
        "showClassicCV": true,
        "visitedDossiers": [
          "ruangrapi",
        ],
        "warmingUp": false,
        "worldEvent": null,
      }
    `);
  });

  it("keeps the order of notifications, writes and timers for every action", async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 26, 12, 0, 0) });
    const { m, events, watch } = await freshStore();
    const s = () => m.useSpaceStore.getState();
    const step = (label: string) => events.push(`-- ${label}`);
    watch();

    step("dock at contact");
    s().setActiveZone("contact");
    s().setOrbitLocked(true);
    s().setOrbitLocked(true);
    await vi.advanceTimersByTimeAsync(0);
    step("break orbit");
    s().breakOrbit();
    s().breakOrbit();
    await vi.advanceTimersByTimeAsync(2000);

    step("dossier");
    s().setWarping(true);
    s().openProjectDossier(PROBES[0].id, "probe");
    s().openProjectDossier(PROBES[0].id, "probe");
    s().closeDossier();
    s().openProjectDossier(PROBES[0].id, "logbook");
    s().closeDossier();
    s().openProjectDossier("nope", "probe");
    s().setProbeNear(PROBES[0].id);
    s().setProbeNear(PROBES[0].id);
    s().setProbeTip("grab");
    s().setProbeTip("grab");

    step("classic cv and remount");
    s().setActiveZone("career");
    s().setOrbitLocked(true);
    s().openProjectDossier(PROBES[0].id, "probe");
    s().setWarping(true);
    s().setShowClassicCV(true);
    s().setShowClassicCV(false);
    s().openProjectDossier(PROBES[0].id, "logbook");
    s().remountCanvas();
    await vi.advanceTimersByTimeAsync(2000);

    step("panels");
    s().setLogbookOpen(true);
    s().setLogbookOpen(true);
    s().setChangelogOpen(true);
    s().setLogbookOpen(true);
    s().setLogbookOpen(false);
    s().setChangelogOpen(false);
    m.useSpaceStore.setState({ changelogSeen: "old" });
    s().markChangelogSeen();
    s().markChangelogSeen();

    step("settings");
    s().setWarmingUp(true);
    s().setLowPerf(true, true);
    s().setLowPerf(false);
    s().setWarmingUp(false);
    s().setWarmingUp(false);
    s().setLowPerf(true);
    s().setReducedMotion(true, true);
    s().setReducedMotion(false);
    s().setMuted(true);
    s().setLiveSky(false);
    s().setLiveSkySeen(true);
    s().setSceneReady(true);
    s().setSceneReady(true);

    step("shards and race");
    s().collectShard(0);
    s().collectShard(0);
    s().setRace({ phase: "idle" });
    s().setRaceBest(42.5);

    step("hud");
    s().requestJump("contact");
    s().requestJump(PROBES[0].id);
    s().requestJump("nope");
    s().bumpImpact();
    s().setScanTarget("x");
    s().setScanTarget("x");
    s().setPhotoMode(true);
    s().setPadConnected(true);
    s().setBeacons([]);
    s().addOwnBeacon("a");
    s().addOwnBeacon("b");
    s().addOwnBeacon("a");
    s().setBeaconPickerOpen(true);
    s().setCometNear(true);
    s().setCometNear(true);
    s().setNearSpawn(false);
    s().setFuelEmpty(true);
    s().setFuelEmpty(true);
    s().triggerTeleportFlash();
    await vi.advanceTimersByTimeAsync(100);
    s().triggerTeleportFlash();
    await vi.advanceTimersByTimeAsync(500);

    step("badge after a fresh broadcast, and plume");
    s().sendBroadcast("payoff");
    s().recordBadge("slingshot");
    s().recordBadge("comet");
    s().sendBroadcast("flavour", { silent: true });
    await vi.advanceTimersByTimeAsync(20000);
    s().setPlumeColor("slingshot");
    s().setPlumeColor("slingshot");
    s().setPlumeColor("nope");

    step("chart every body");
    for (const id of BODY_IDS) s().chartWorld(id);
    s().chartWorld(BODY_IDS[0]);
    await vi.advanceTimersByTimeAsync(2000);
    s().sendBroadcast("interrupt");
    await vi.advanceTimersByTimeAsync(120000);
    s().tellAurumOnce();
    m.useSpaceStore.setState({ aurumTold: false });
    s().tellAurumOnce();
    await vi.advanceTimersByTimeAsync(20000);
    s().clearChartShout();

    step("world event");
    s().startWorldEvent({ kind: "flare", id: 1, startedAt: 10 }, "FLARE");
    m.worldClock.now = 12;
    events.push(`elapsed ${m.worldEventElapsed("flare")} ${m.worldEventElapsed("comet")}`);
    s().endWorldEvent();
    s().endWorldEvent();

    expect(events).toMatchInlineSnapshot(`
      [
        "ambient true",
        "write fitz-changelog-seen="<newest changelog id>"",
        "-- dock at contact",
        "set activeZone="contact"",
        "set isOrbitLocked=true",
        "write fitz-logbook=[{"id":"contact","at":"2026-10-26"}]",
        "set badges=[{"id":"contact","at":"2026-10-26"}]",
        "set logbookLineAt=1792990804500",
        "set broadcast={"id":1,"text":"LOGBOOK // CONTACT PORTAL REACHED","silent":false,"at":1792990800000}",
        "-- break orbit",
        "set activeZone=null isOrbitCooldown=true isOrbitLocked=false",
        "set ",
        "set isOrbitCooldown=false",
        "-- dossier",
        "set isWarping=true",
        "write fitz-dossiers=["ruangrapi"]",
        "set dossierVia="probe" isWarping=false openDossier="ruangrapi" visitedDossiers=["ruangrapi"]",
        "write fitz-probes={"ruangrapi":1,"portfolio":0,"fuxx":0}",
        "set dossierVia=null openDossier=null probeSpots={"ruangrapi":1,"portfolio":0,"fuxx":0} relocation={"id":"ruangrapi","seq":1}",
        "set dossierVia="logbook" openDossier="ruangrapi"",
        "set dossierVia=null openDossier=null",
        "set probeNear="ruangrapi"",
        "set probeTip="grab"",
        "-- classic cv and remount",
        "set activeZone="career"",
        "set isOrbitLocked=true",
        "write fitz-logbook=[{"id":"contact","at":"2026-10-26"},{"id":"career","at":"2026-10-26"}]",
        "set badges=[{"id":"contact","at":"2026-10-26"},{"id":"career","at":"2026-10-26"}]",
        "set dossierVia="probe" openDossier="ruangrapi"",
        "set isWarping=true",
        "set activeZone=null isOrbitCooldown=true isOrbitLocked=false",
        "write fitz-probes={"ruangrapi":2,"portfolio":0,"fuxx":0}",
        "set dossierVia=null openDossier=null probeSpots={"ruangrapi":2,"portfolio":0,"fuxx":0} relocation={"id":"ruangrapi","seq":2}",
        "set isWarping=false",
        "set showClassicCV=false",
        "set dossierVia="logbook" openDossier="ruangrapi"",
        "set ",
        "set dossierVia=null openDossier=null",
        "set canvasEpoch=1",
        "set logbookLineAt=1792990811000",
        "set isOrbitCooldown=false",
        "-- panels",
        "set logbookOpen=true",
        "set changelogOpen=true logbookOpen=false",
        "set changelogOpen=false logbookOpen=true",
        "set logbookOpen=false",
        "set changelogSeen="old"",
        "write fitz-changelog-seen="<newest changelog id>"",
        "set changelogSeen="<newest changelog id>"",
        "-- settings",
        "set warmingUp=true",
        "set lowPerfManual=true pendingLowPerf=true",
        "set pendingLowPerf=false",
        "set pendingLowPerf=null warmingUp=false",
        "set isLowPerf=true",
        "write fitz-reduced-motion=1",
        "ambient false",
        "set reducedMotion=true reducedMotionManual=true",
        "ambient true",
        "set reducedMotion=false",
        "set isMuted=true",
        "write fitz-sound-muted=1",
        "set liveSky=false",
        "write fitz-live-sky=0",
        "set liveSkySeen=true",
        "write fitz-live-seen-2=1",
        "set sceneReady=true",
        "-- shards and race",
        "set shardsCollected=[0]",
        "write fitz-shards=[0]",
        "set race={"phase":"idle"}",
        "write fitz-race-best=42.5",
        "set raceBest=42.5",
        "-- hud",
        "set jumpRequest={"id":"contact","seq":1}",
        "set jumpRequest={"id":"ruangrapi","seq":2}",
        "set impactCount=1",
        "set scanTarget="x"",
        "set photoMode=true",
        "set padConnected=true",
        "set beacons=[]",
        "write fitz-own-beacons=["a"]",
        "set ownBeacons=["a"]",
        "write fitz-own-beacons=["b","a"]",
        "set ownBeacons=["b","a"]",
        "write fitz-own-beacons=["a","b"]",
        "set ownBeacons=["a","b"]",
        "set beaconPickerOpen=true",
        "set cometNear=true",
        "set isNearSpawn=false",
        "set fuelEmpty=true",
        "set isTeleporting=true",
        "set ",
        "set isTeleporting=false",
        "-- badge after a fresh broadcast, and plume",
        "set broadcast={"id":2,"text":"payoff","silent":false,"at":1792990804600}",
        "write fitz-logbook=[{"id":"contact","at":"2026-10-26"},{"id":"career","at":"2026-10-26"},{"id":"slingshot","at":"2026-10-26"}]",
        "set badges=[{"id":"contact","at":"2026-10-26"},{"id":"career","at":"2026-10-26"},{"id":"slingshot","at":"2026-10-26"}]",
        "write fitz-logbook=[{"id":"contact","at":"2026-10-26"},{"id":"career","at":"2026-10-26"},{"id":"slingshot","at":"2026-10-26"},{"id":"comet","at":"2026-10-26"}]",
        "set badges=[{"id":"contact","at":"2026-10-26"},{"id":"career","at":"2026-10-26"},{"id":"slingshot","at":"2026-10-26"},{"id":"comet","at":"2026-10-26"}]",
        "set broadcast={"id":3,"text":"flavour","silent":true,"at":1792990804600}",
        "set logbookLineAt=1792990815500",
        "set logbookLineAt=1792990820000",
        "set broadcast={"id":4,"text":"LOGBOOK // SLINGSHOT EARNED — GOLD PLUME UNLOCKED. DOCK AT THE SHIPYARD [5]","silent":false,"at":1792990811000}",
        "set broadcast={"id":5,"text":"LOGBOOK // CAREER DOSSIER READ","silent":false,"at":1792990811000}",
        "set broadcast={"id":6,"text":"LOGBOOK // COMET CHASER EARNED — ICE PLUME UNLOCKED. DOCK AT THE SHIPYARD [5]","silent":false,"at":1792990815500}",
        "write fitz-plume="slingshot"",
        "set plumeColor="slingshot"",
        "-- chart every body",
        "write fitz-charted=[{"id":"mercury","at":"2026-10-26"}]",
        "set charted=[{"id":"mercury","at":"2026-10-26"}]",
        "write fitz-charted=[{"id":"mercury","at":"2026-10-26"},{"id":"venus","at":"2026-10-26"}]",
        "set charted=[{"id":"mercury","at":"2026-10-26"},{"id":"venus","at":"2026-10-26"}]",
        "write fitz-charted=[{"id":"mercury","at":"2026-10-26"},{"id":"venus","at":"2026-10-26"},{"id":"earth","at":"2026-10-26"}]",
        "set charted=[{"id":"mercury","at":"2026-10-26"},{"id":"venus","at":"2026-10-26"},{"id":"earth","at":"2026-10-26"}]",
        "write fitz-charted=[{"id":"mercury","at":"2026-10-26"},{"id":"venus","at":"2026-10-26"},{"id":"earth","at":"2026-10-26"},{"id":"mars","at":"2026-10-26"}]",
        "set charted=[{"id":"mercury","at":"2026-10-26"},{"id":"venus","at":"2026-10-26"},{"id":"earth","at":"2026-10-26"},{"id":"mars","at":"2026-10-26"}]",
        "write fitz-charted=[{"id":"mercury","at":"2026-10-26"},{"id":"venus","at":"2026-10-26"},{"id":"earth","at":"2026-10-26"},{"id":"mars","at":"2026-10-26"},{"id":"ceres","at":"2026-10-26"}]",
        "set charted=[{"id":"mercury","at":"2026-10-26"},{"id":"venus","at":"2026-10-26"},{"id":"earth","at":"2026-10-26"},{"id":"mars","at":"2026-10-26"},{"id":"ceres","at":"2026-10-26"}]",
        "write fitz-charted=[{"id":"mercury","at":"2026-10-26"},{"id":"venus","at":"2026-10-26"},{"id":"earth","at":"2026-10-26"},{"id":"mars","at":"2026-10-26"},{"id":"ceres","at":"2026-10-26"},{"id":"jupiter","at":"2026-10-26"}]",
        "set charted=[{"id":"mercury","at":"2026-10-26"},{"id":"venus","at":"2026-10-26"},{"id":"earth","at":"2026-10-26"},{"id":"mars","at":"2026-10-26"},{"id":"ceres","at":"2026-10-26"},{"id":"jupiter","at":"2026-10-26"}]",
        "write fitz-charted=[{"id":"mercury","at":"2026-10-26"},{"id":"venus","at":"2026-10-26"},{"id":"earth","at":"2026-10-26"},{"id":"mars","at":"2026-10-26"},{"id":"ceres","at":"2026-10-26"},{"id":"jupiter","at":"2026-10-26"},{"id":"saturn","at":"2026-10-26"}]",
        "set charted=[{"id":"mercury","at":"2026-10-26"},{"id":"venus","at":"2026-10-26"},{"id":"earth","at":"2026-10-26"},{"id":"mars","at":"2026-10-26"},{"id":"ceres","at":"2026-10-26"},{"id":"jupiter","at":"2026-10-26"},{"id":"saturn","at":"2026-10-26"}]",
        "write fitz-charted=[{"id":"mercury","at":"2026-10-26"},{"id":"venus","at":"2026-10-26"},{"id":"earth","at":"2026-10-26"},{"id":"mars","at":"2026-10-26"},{"id":"ceres","at":"2026-10-26"},{"id":"jupiter","at":"2026-10-26"},{"id":"saturn","at":"2026-10-26"},{"id":"uranus","at":"2026-10-26"}]",
        "set charted=[{"id":"mercury","at":"2026-10-26"},{"id":"venus","at":"2026-10-26"},{"id":"earth","at":"2026-10-26"},{"id":"mars","at":"2026-10-26"},{"id":"ceres","at":"2026-10-26"},{"id":"jupiter","at":"2026-10-26"},{"id":"saturn","at":"2026-10-26"},{"id":"uranus","at":"2026-10-26"}]",
        "write fitz-charted=[{"id":"mercury","at":"2026-10-26"},{"id":"venus","at":"2026-10-26"},{"id":"earth","at":"2026-10-26"},{"id":"mars","at":"2026-10-26"},{"id":"ceres","at":"2026-10-26"},{"id":"jupiter","at":"2026-10-26"},{"id":"saturn","at":"2026-10-26"},{"id":"uranus","at":"2026-10-26"},{"id":"neptune","at":"2026-10-26"}]",
        "set charted=[{"id":"mercury","at":"2026-10-26"},{"id":"venus","at":"2026-10-26"},{"id":"earth","at":"2026-10-26"},{"id":"mars","at":"2026-10-26"},{"id":"ceres","at":"2026-10-26"},{"id":"jupiter","at":"2026-10-26"},{"id":"saturn","at":"2026-10-26"},{"id":"uranus","at":"2026-10-26"},{"id":"neptune","at":"2026-10-26"}]",
        "write fitz-aurum-told=1",
        "set aurumTold=true",
        "write fitz-charted-shout=1792990824600",
        "set chartShoutAt=1792990824600",
        "set logbookLineAt=1792990829100",
        "set broadcast={"id":7,"text":"WORLD CHARTED 1/9 — MERCURY: THE SMALLEST PLANET, AND THE FASTEST AROUND THE SUN","silent":false,"at":1792990824600}",
        "set logbookLineAt=1792990833600",
        "set logbookLineAt=1792990838100",
        "set logbookLineAt=1792990842600",
        "set logbookLineAt=1792990847100",
        "set logbookLineAt=1792990851600",
        "set logbookLineAt=1792990856100",
        "set logbookLineAt=1792990860600",
        "set logbookLineAt=1792990865100",
        "set logbookLineAt=1792990869600",
        "set logbookLineAt=1792990874100",
        "set broadcast={"id":8,"text":"interrupt","silent":false,"at":1792990826600}",
        "set broadcast={"id":9,"text":"WORLD CHARTED 3/9 — EARTH: THE ONLY WORLD KNOWN TO HOLD LIFE AND SURFACE OCEANS","silent":false,"at":1792990833600}",
        "set broadcast={"id":10,"text":"WORLD CHARTED 2/9 — VENUS: THE HOTTEST PLANET: A RUNAWAY GREENHOUSE UNDER SULFURIC-ACID CLOUDS","silent":false,"at":1792990833600}",
        "set broadcast={"id":11,"text":"WORLD CHARTED 4/9 — MARS: IRON-OXIDE DUST GIVES IT ITS RED","silent":false,"at":1792990838100}",
        "set broadcast={"id":12,"text":"WORLD CHARTED 5/9 — CERES: THE LARGEST BODY IN THE ASTEROID BELT: ROUND, BUT NOT A PLANET","silent":false,"at":1792990842600}",
        "set broadcast={"id":13,"text":"WORLD CHARTED 6/9 — JUPITER: MORE MASSIVE THAN ALL THE OTHER PLANETS TOGETHER, TWICE OVER","silent":false,"at":1792990847100}",
        "set broadcast={"id":14,"text":"WORLD CHARTED 7/9 — SATURN: LESS DENSE THAN WATER (0.69 G/CM³)","silent":false,"at":1792990851600}",
        "set broadcast={"id":15,"text":"WORLD CHARTED 8/9 — URANUS: IT ROLLS AROUND THE SUN ON ITS SIDE","silent":false,"at":1792990856100}",
        "set broadcast={"id":16,"text":"WORLD CHARTED 9/9 — NEPTUNE: METHANE GAS GIVES THE BLUE","silent":false,"at":1792990860600}",
        "set broadcast={"id":17,"text":"SYSTEM SURVEY COMPLETE — EVERY WORLD CHARTED. YOU HOLD THE TITLE CARTOGRAPHER.","silent":false,"at":1792990865100}",
        "set broadcast={"id":18,"text":"AURUM PLUME UNLOCKED // FIT IT IN THE SHIPYARD HANGAR","silent":false,"at":1792990869600}",
        "set aurumTold=false",
        "write fitz-aurum-told=1",
        "set aurumTold=true",
        "set logbookLineAt=1792990951100",
        "set broadcast={"id":19,"text":"AURUM PLUME UNLOCKED // FIT IT IN THE SHIPYARD HANGAR","silent":false,"at":1792990946600}",
        "write fitz-charted-shout=null",
        "set chartShoutAt=null",
        "-- world event",
        "set worldEvent={"kind":"flare","id":1,"startedAt":10}",
        "set broadcast={"id":20,"text":"FLARE","silent":false,"at":1792990966600}",
        "elapsed 2 null",
        "set worldEvent=null",
      ]
    `);
  });
});
