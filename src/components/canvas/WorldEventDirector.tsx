import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSpaceStore, flight, bodies, worldClock, selectSceneFrozen, worldEventElapsed, type WorldEventState } from "../../store/spaceStore";
import { SUN_RADIUS } from "../../constants";
import { createDirector, stepDirector, skipEvent, forceStart, ambientStep, EVENT_DURATION, type WorldEventKind, type ActiveEvent, type DirectorStep, type DirectorInput } from "../../utils/eventDirector";
import { planCometPass, planConvoy, convoyShipOffsetAt, CONVOY_APPROACH_S, CONVOY_ORBIT_S, type Sphere } from "../../utils/worldEvents";
import { convoySighted } from "../../utils/logbook";
import { RADIO_BUSY_S } from "../../utils/cargoReaction";
import { gameTime, ambientTime } from "../../utils/ambientTime";
import { bodyPositionAt } from "../../utils/bodyPositions";
import { orbitShape, visVivaKmS, JD_J2000 } from "../../utils/ephemeris";
import { KM_PER_UNIT, SECONDS_PER_GAME_SECOND } from "../../utils/realUnits";
import { SOLAR_BODIES } from "../../data/solarSystem";
import { eventLines } from "../../data/chatterLines";
import { fitzDebug } from "../../debug/bridge";

/**
 * Pad on each body for a comet line cleared against where they are at the
 * start: the fastest one's drift over the whole pass (Mercury at perihelion,
 * ~3.4 u/s by vis-viva), plus the visitor's coma (~4.2u) and a margin.
 */
const FASTEST_BODY_U_PER_S = Math.max(...SOLAR_BODIES.map((b) => {
  const s = orbitShape(b.orbit.el, JD_J2000);
  return (visVivaKmS(s.a * (1 - s.e), s.a) * SECONDS_PER_GAME_SECOND) / KM_PER_UNIT;
}));
const COMET_PLANET_PAD = FASTEST_BODY_U_PER_S * EVENT_DURATION.comet + 6;
/** Convoy-route scratch: a body's position along the route's 40 s. */
const routeTarget = { x: 0, y: 0, z: 0 };
const routeOther = { x: 0, y: 0, z: 0 };
const pick = (lines: string[]) => lines[Math.floor(Math.random() * lines.length)];
/** Convoy ship positions for the logbook sighting check (reused). */
const sightShips = [0, 1, 2].map(() => ({ x: 0, y: 0, z: 0 }));
const sightOff = { x: 0, y: 0, z: 0 };

/**
 * Turns a director start into a stored event with its target, or null when no
 * clear route exists (the event is then skipped and the next is scheduled).
 * Comet: a line past the player's current position, clear of the sun and of
 * every body padded for its drift. Convoy: the body nearest the player, on an
 * approach that clears the other bodies and the sun at their positions
 * through the next 40s.
 */
function planEvent(ev: ActiveEvent, ambientNow: number): { state: WorldEventState; line: string } | null {
  const base = { kind: ev.kind, id: ev.id, startedAt: ev.startedAt };
  if (ev.kind === "flare") return { state: base, line: pick(eventLines.flare) };

  if (ev.kind === "comet") {
    const avoid: Sphere[] = [
      { x: 0, y: 0, z: 0, r: SUN_RADIUS + 6 },
      ...SOLAR_BODIES.map((b) => ({ ...bodies[b.id], r: b.size + COMET_PLANET_PAD })),
    ];
    const comet = planCometPass(flight, avoid, Math.random);
    return comet ? { state: { ...base, comet }, line: pick(eventLines.comet) } : null;
  }

  // convoy: the nearest body
  let target = SOLAR_BODIES[0];
  let best = Infinity;
  for (const b of SOLAR_BODIES) {
    const p = bodies[b.id];
    const d = Math.hypot(p.x - flight.x, p.y - flight.y, p.z - flight.z);
    if (d < best) { best = d; target = b; }
  }
  const off = { x: 0, y: 0, z: 0 };
  const plan = planConvoy(bodies[target.id], target.size, (candidate) => {
    for (let t = 0; t <= 40; t += 0.5) {
      const c = bodyPositionAt(target, ambientNow + t, routeTarget);
      for (const slot of [0, 1, 2] as const) {
        convoyShipOffsetAt(off, candidate, t, slot);
        const x = c.x + off.x, y = c.y + off.y, z = c.z + off.z;
        if (Math.hypot(x, y, z) < SUN_RADIUS + 10) return false;
        for (const b of SOLAR_BODIES) {
          if (b === target) continue;
          const q = bodyPositionAt(b, ambientNow + t, routeOther);
          if (Math.hypot(x - q.x, y - q.y, z - q.z) < b.size + 6) return false;
        }
      }
    }
    return true;
  });
  return plan
    ? { state: { ...base, convoy: { planet: target.id, plan } }, line: pick(eventLines.convoy[target.id] ?? eventLines.convoyAny) }
    : null;
}

/** Steps the world-event director each frame and publishes its events to the store. */
export default function WorldEventDirector() {
  const director = useMemo(() => createDirector(Math.random), []);
  const lastBroadcast = useRef({ id: 0, at: -Infinity });
  const forced = useRef<WorldEventKind | null>(null);
  const lastAmbient = useRef<number | null>(null);
  const nextSightAt = useRef(0);
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
    // The director runs on the bodies' clock (ambient time): comet lines and
    // convoy routes are cleared against body positions on that clock, so the
    // event must play on it too. It also freezes under reduced motion, as the
    // bodies do, so an event caught by that setting freezes with the scene.
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

    // Logbook: a convoy watched up close during its delivery orbit (twice a second).
    const conv = s.worldEvent?.convoy;
    const convElapsed = worldEventElapsed("convoy");
    if (conv && convElapsed !== null && convElapsed >= CONVOY_APPROACH_S
      && convElapsed <= CONVOY_APPROACH_S + CONVOY_ORBIT_S && now >= nextSightAt.current) {
      nextSightAt.current = now + 0.5;
      const c = bodies[conv.planet];
      for (let k = 0; k < 3; k++) {
        convoyShipOffsetAt(sightOff, conv.plan, convElapsed, k as 0 | 1 | 2);
        sightShips[k].x = c.x + sightOff.x; sightShips[k].y = c.y + sightOff.y; sightShips[k].z = c.z + sightOff.z;
      }
      if (convoySighted(flight, sightShips)) s.recordBadge("convoy");
    }
  });

  return null;
}
