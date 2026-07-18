import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSpaceStore, flight } from "../src/store/spaceStore";

beforeEach(() => {
  useSpaceStore.setState({
    activeZone: null, isOrbitLocked: false, isOrbitCooldown: false,
    isWarping: false, isLowPerf: false, lowPerfManual: false,
    showClassicCV: false, isNearSpawn: true, isTeleporting: false, isMuted: false,
    cometNear: false, altitudeWarn: false,
  });
});

describe("spaceStore", () => {
  it("breakOrbit clears lock+zone and runs an 1800ms cooldown", () => {
    vi.useFakeTimers();
    useSpaceStore.setState({ isOrbitLocked: true, activeZone: "saas" });
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
    useSpaceStore.getState().setActiveZone("video");
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
});
