import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSpaceStore, flight, bodies, worldClock, selectSceneFrozen, type WorldEventState } from "../../store/spaceStore";
import { planets, SUN_RADIUS } from "../../constants";
import { createDirector, stepDirector, skipEvent, forceStart, ambientStep, EVENT_DURATION, type WorldEventKind, type ActiveEvent, type DirectorStep, type DirectorInput } from "../../utils/eventDirector";
import { planCometPass, planConvoy, convoyShipOffsetAt, type Sphere } from "../../utils/worldEvents";
import { RADIO_BUSY_S } from "../../utils/cargoReaction";
import { gameTime, ambientTime } from "../../utils/ambientTime";
import { orbitPosition } from "../../utils/orbits";
import { eventLines } from "../../data/chatterLines";
import { fitzDebug } from "../../debug/bridge";

/**
 * Pad on each planet for a comet line cleared against where the planets are at
 * the start: the fastest planet's drift over the whole pass (fuxx ~1.94u/s),
 * plus the visitor's coma (~4.2u) and a margin.
 */
const COMET_PLANET_PAD =
  Math.max(...planets.map((p) => p.orbit.radius * Math.abs(p.orbit.angularSpeed))) * EVENT_DURATION.comet + 6;
const pick = (lines: string[]) => lines[Math.floor(Math.random() * lines.length)];

/**
 * Turns a director start into a stored event with its target, or null when no
 * clear route exists (the event is then skipped and the next is scheduled).
 * Comet: a line past the player's current position, clear of the sun and of
 * every planet padded for its drift. Convoy: the planet nearest the player,
 * on an approach that clears the other planets and the sun at their positions
 * through the next 40s.
 */
function planEvent(ev: ActiveEvent, ambientNow: number): { state: WorldEventState; line: string } | null {
  const base = { kind: ev.kind, id: ev.id, startedAt: ev.startedAt };
  if (ev.kind === "flare") return { state: base, line: pick(eventLines.flare) };

  if (ev.kind === "comet") {
    const avoid: Sphere[] = [
      { x: 0, y: 0, z: 0, r: SUN_RADIUS + 6 },
      ...planets.map((p) => ({ ...bodies[p.name], r: p.size + COMET_PLANET_PAD })),
    ];
    const comet = planCometPass(flight, avoid, Math.random);
    return comet ? { state: { ...base, comet }, line: pick(eventLines.comet) } : null;
  }

  // convoy: the nearest planet
  let target = planets[0];
  let best = Infinity;
  for (const p of planets) {
    const b = bodies[p.name];
    const d = Math.hypot(b.x - flight.x, b.y - flight.y, b.z - flight.z);
    if (d < best) { best = d; target = p; }
  }
  const off = { x: 0, y: 0, z: 0 };
  const plan = planConvoy(bodies[target.name], target.size, (candidate) => {
    for (let t = 0; t <= 40; t += 0.5) {
      const c = orbitPosition(target.orbit, ambientNow + t);
      for (const slot of [0, 1, 2] as const) {
        convoyShipOffsetAt(off, candidate, t, slot);
        const x = c.x + off.x, y = c.y + off.y, z = c.z + off.z;
        if (Math.hypot(x, y, z) < SUN_RADIUS + 10) return false;
        for (const p of planets) {
          if (p.name === target.name) continue;
          const q = orbitPosition(p.orbit, ambientNow + t);
          if (Math.hypot(x - q.x, y - q.y, z - q.z) < p.size + 6) return false;
        }
      }
    }
    return true;
  });
  return plan
    ? { state: { ...base, convoy: { planet: target.name, plan } }, line: pick(eventLines.convoy[target.name] ?? eventLines.convoyAny) }
    : null;
}

/** Steps the world-event director each frame and publishes its events to the store. */
export default function WorldEventDirector() {
  const director = useMemo(() => createDirector(Math.random), []);
  const lastBroadcast = useRef({ id: 0, at: -Infinity });
  const forced = useRef<WorldEventKind | null>(null);
  const lastAmbient = useRef<number | null>(null);
  // Reused every frame so the director step allocates nothing.
  const stepOut = useMemo<DirectorStep>(() => ({ started: null, ended: null }), []);
  const dirInput = useMemo<DirectorInput>(
    () => ({ dt: 0, paused: false, raceRunning: false, radioBusy: false, reducedMotion: false }), []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.triggerEvent = (kind) => { forced.current = kind; };
    return () => { fitzDebug.triggerEvent = null; };
  }, []);
  // Unmounting (the classic-résumé round trip) must not leave an event behind.
  useEffect(() => () => useSpaceStore.getState().endWorldEvent(), []);

  useFrame((state) => {
    // The director runs on the planets' clock (ambient time): comet lines and
    // convoy routes are cleared against planet positions on that clock, so the
    // event must play on it too. It also freezes under reduced motion, as the
    // planets do, so an event caught by that setting freezes with the scene.
    const elapsed = state.clock.getElapsedTime();
    const ambientNow = ambientTime(elapsed);
    const dt = ambientStep(lastAmbient.current, ambientNow);
    lastAmbient.current = ambientNow;
    const now = gameTime(elapsed);
    const s = useSpaceStore.getState();
    const bid = s.broadcast?.id ?? 0;
    if (bid !== lastBroadcast.current.id) { lastBroadcast.current.id = bid; lastBroadcast.current.at = now; }

    let step: DirectorStep;
    if (forced.current) {
      step = forceStart(director, forced.current);
      forced.current = null;
    } else {
      dirInput.dt = dt;
      // Not photo mode: the planets keep orbiting there, so the event must too.
      dirInput.paused = selectSceneFrozen(s) || s.showClassicCV;
      dirInput.raceRunning = s.race.phase === "running";
      dirInput.radioBusy = now - lastBroadcast.current.at < RADIO_BUSY_S;
      dirInput.reducedMotion = s.reducedMotion;
      step = stepDirector(director, dirInput, stepOut);
    }
    worldClock.now = director.clock;

    if (step.ended) s.endWorldEvent();
    if (step.started) {
      const planned = planEvent(step.started, ambientNow);
      if (planned) s.startWorldEvent(planned.state, planned.line);
      else skipEvent(director); // no clear route: retry shortly, as another kind
    }
  });

  return null;
}
