import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSpaceStore, flight, bodies, worldClock, selectSceneFrozen, worldEventElapsed, type WorldEventState } from "../../store/spaceStore";
import { SUN_RADIUS } from "../../constants";
import { createDirector, stepDirector, skipEvent, forceStart, ambientStep, EVENT_DURATION, type WorldEventKind, type ActiveEvent, type DirectorStep, type DirectorInput } from "../../utils/eventDirector";
import { planCometPass, planNearestConvoy, convoyShipOffsetAt, CONVOY_APPROACH_S, CONVOY_ORBIT_S, type Sphere } from "../../utils/worldEvents";
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
/** The convoy route is checked every ROUTE_DT over its first 40 s. */
const ROUTE_DT = 0.5;
const ROUTE_STEPS = 40 / ROUTE_DT + 1;
/** Convoy-route scratch: every body's position at each route step, filled once per plan. */
const routeTrack = new Float64Array(ROUTE_STEPS * SOLAR_BODIES.length * 3);
const routeScratch = { x: 0, y: 0, z: 0 };
const pick = (lines: string[]) => lines[Math.floor(Math.random() * lines.length)];
/** Convoy ship positions for the logbook sighting check (reused). */
const sightShips = [0, 1, 2].map(() => ({ x: 0, y: 0, z: 0 }));
const sightOff = { x: 0, y: 0, z: 0 };

/**
 * Turns a director start into a stored event with its target, or null when no
 * clear route exists (the event is then skipped and the next is scheduled).
 * Comet: a line past the player's current position, clear of the sun and of
 * every body padded for its drift. Convoy: the body nearest the player that
 * has an approach clearing the other bodies and the sun at their positions
 * through the next 40s (Mercury's rarely clears the sun, so a convoy near it
 * goes to the next body out). `bodiesFrozen` (reduced motion: the bodies hold
 * still) clears the route against where they are now, not where they would be.
 */
function planEvent(ev: ActiveEvent, ambientNow: number, bodiesFrozen: boolean): { state: WorldEventState; line: string } | null {
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

  // convoy: the nearest body with a clear route.
  // Every body's position along the route's 40 s, once per plan (not per
  // target, candidate and slot): ROUTE_STEPS × SOLAR_BODIES, xyz.
  const bodyStep = bodiesFrozen ? 0 : ROUTE_DT;
  for (let s = 0; s < ROUTE_STEPS; s++) {
    for (let i = 0; i < SOLAR_BODIES.length; i++) {
      const q = bodyPositionAt(SOLAR_BODIES[i], ambientNow + s * bodyStep, routeScratch);
      const o = (s * SOLAR_BODIES.length + i) * 3;
      routeTrack[o] = q.x; routeTrack[o + 1] = q.y; routeTrack[o + 2] = q.z;
    }
  }
  const off = { x: 0, y: 0, z: 0 };
  const found = planNearestConvoy(SOLAR_BODIES, (b) => bodies[b.id], flight, (target, candidate) => {
    const ti = SOLAR_BODIES.indexOf(target);
    for (let s = 0; s < ROUTE_STEPS; s++) {
      const row = s * SOLAR_BODIES.length * 3, c = row + ti * 3;
      for (const slot of [0, 1, 2] as const) {
        convoyShipOffsetAt(off, candidate, s * ROUTE_DT, slot);
        const x = routeTrack[c] + off.x, y = routeTrack[c + 1] + off.y, z = routeTrack[c + 2] + off.z;
        if (Math.hypot(x, y, z) < SUN_RADIUS + 10) return false;
        for (let i = 0; i < SOLAR_BODIES.length; i++) {
          if (i === ti) continue;
          const o = row + i * 3;
          if (Math.hypot(x - routeTrack[o], y - routeTrack[o + 1], z - routeTrack[o + 2]) < SOLAR_BODIES[i].size + 6) return false;
        }
      }
    }
    return true;
  });
  return found
    ? { state: { ...base, convoy: { planet: found.body.id, plan: found.plan } }, line: pick(eventLines.convoy[found.body.id] ?? eventLines.convoyAny) }
    : null;
}

/** Steps the world-event director each frame and publishes its events to the store. */
export default function WorldEventDirector() {
  const director = useMemo(() => createDirector(Math.random), []);
  const lastBroadcast = useRef({ id: 0, at: -Infinity });
  const forced = useRef<WorldEventKind | null>(null);
  const lastAmbient = useRef<number | null>(null);
  const lastGame = useRef<number | null>(null);
  const nextSightAt = useRef(0);
  // Reused every frame so the director step allocates nothing.
  const stepOut = useMemo<DirectorStep>(() => ({ started: null, ended: null }), []);
  const dirInput = useMemo<DirectorInput>(
    () => ({ dt: 0, paused: false, raceRunning: false, radioBusy: false, reducedMotion: false }), []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.triggerEvent = (kind) => { forced.current = kind; };
    fitzDebug.eventDirector = director;
    return () => { fitzDebug.triggerEvent = null; fitzDebug.eventDirector = null; };
  }, [director]);
  // Unmounting (the classic-résumé round trip) must not leave an event behind.
  useEffect(() => () => useSpaceStore.getState().endWorldEvent(), []);

  useFrame((state) => {
    // The director runs on the bodies' clock (ambient time): comet lines and
    // convoy routes are cleared against body positions on that clock, so the
    // event must play on it too. Under reduced motion the bodies freeze but
    // comets and convoys still run (slow movers; the flare never does), so the
    // director steps on game time instead, and routes are cleared against the
    // frozen bodies (planEvent's `bodiesFrozen`).
    const elapsed = state.clock.getElapsedTime();
    const ambientNow = ambientTime(elapsed);
    const now = gameTime(elapsed);
    const s = useSpaceStore.getState();
    const dt = s.reducedMotion ? ambientStep(lastGame.current, now) : ambientStep(lastAmbient.current, ambientNow);
    lastAmbient.current = ambientNow;
    lastGame.current = now;
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
      dirInput.raceRunning = s.raceView.phase === "running";
      dirInput.radioBusy = now - lastBroadcast.current.at < RADIO_BUSY_S;
      dirInput.reducedMotion = s.reducedMotion;
      step = stepDirector(director, dirInput, stepOut);
    }
    worldClock.now = director.clock;

    if (step.ended) s.endWorldEvent();
    if (step.started) {
      const planned = planEvent(step.started, ambientNow, s.reducedMotion);
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
