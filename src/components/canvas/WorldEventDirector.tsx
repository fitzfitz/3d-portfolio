import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSpaceStore, flight, bodies, worldClock, selectSceneFrozen, type WorldEventState } from "../../store/spaceStore";
import { planets, SUN_RADIUS } from "../../constants";
import { createDirector, stepDirector, endEvent, forceStart, type WorldEventKind, type ActiveEvent } from "../../utils/eventDirector";
import { planCometPass, planConvoy, convoyShipOffsetAt, type Sphere } from "../../utils/worldEvents";
import { RADIO_BUSY_S } from "../../utils/cargoReaction";
import { gameTime, ambientTime } from "../../utils/ambientTime";
import { orbitPosition } from "../../utils/orbits";
import { eventLines } from "../../data/chatterLines";
import { fitzDebug } from "../../debug/bridge";

/** Planets drift ≤ ~1.8u/s, so a 25s comet pass pads each planet by this much. */
const COMET_PLANET_PAD = 4 + 1.8 * 25;
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
    ? { state: { ...base, convoy: { planet: target.name, plan } }, line: pick(eventLines.convoy[target.name] ?? eventLines.flare) }
    : null;
}

/** Steps the world-event director each frame and publishes its events to the store. */
export default function WorldEventDirector() {
  const director = useMemo(() => createDirector(Math.random), []);
  const lastBroadcast = useRef({ id: 0, at: -Infinity });
  const forced = useRef<WorldEventKind | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.triggerEvent = (kind) => { forced.current = kind; };
    return () => { fitzDebug.triggerEvent = null; };
  }, []);
  // Unmounting (the classic-résumé round trip) must not leave an event behind.
  useEffect(() => () => useSpaceStore.getState().endWorldEvent(), []);

  useFrame((state, delta) => {
    // Scheduling clock, not motion: capped at 0.25s rather than 0.05 so slow
    // devices don't run it at a fraction of real time (see plan constraints).
    const dt = Math.min(delta, 0.25);
    const elapsed = state.clock.getElapsedTime();
    const now = gameTime(elapsed);
    const s = useSpaceStore.getState();
    const bid = s.broadcast?.id ?? 0;
    if (bid !== lastBroadcast.current.id) lastBroadcast.current = { id: bid, at: now };

    let step;
    if (forced.current) {
      step = forceStart(director, forced.current);
      forced.current = null;
    } else {
      step = stepDirector(director, {
        dt,
        paused: selectSceneFrozen(s) || s.photoMode || s.showClassicCV,
        raceRunning: s.race.phase === "running",
        radioBusy: now - lastBroadcast.current.at < RADIO_BUSY_S,
        reducedMotion: s.reducedMotion,
      });
    }
    worldClock.now = director.clock;

    if (step.ended) s.endWorldEvent();
    if (step.started) {
      const planned = planEvent(step.started, ambientTime(elapsed));
      if (planned) s.startWorldEvent(planned.state, planned.line);
      else endEvent(director); // no clear route this time: skip it, schedule the next
    }
  });

  return null;
}
