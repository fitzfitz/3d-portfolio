export interface AsteroidData {
  position: [number, number, number];
  scale: number;
  rotationSpeed: [number, number, number];
  initialRotation: [number, number, number];
  /** which sculpted mesh in asteroids.glb: 0 boulder, 1 shard, 2 contact binary, 3 rubble chunk */
  variant: 0 | 1 | 2 | 3;
}

export const asteroidInstances: AsteroidData[] = [
  // Near-ecliptic band (familiar territory)
  { position: [-40, -5, -60], scale: 1.5, rotationSpeed: [0.08, 0.05, 0.03], initialRotation: [0.2, 0.5, 0.1], variant: 0 },
  { position: [60, 12, 70], scale: 2.2, rotationSpeed: [-0.05, 0.08, 0.04], initialRotation: [1.2, 0.2, 0.5], variant: 1 },
  { position: [-90, -18, -20], scale: 1.2, rotationSpeed: [0.04, -0.06, 0.08], initialRotation: [0.5, 1.1, 0.2], variant: 3 },
  { position: [80, 25, -120], scale: 2.8, rotationSpeed: [0.03, 0.04, -0.05], initialRotation: [0.8, 0.3, 0.9], variant: 2 },
  { position: [-160, 30, 20], scale: 3.5, rotationSpeed: [-0.04, 0.03, 0.06], initialRotation: [2.1, 0.4, 0.2], variant: 2 },
  { position: [110, -35, 120], scale: 1.8, rotationSpeed: [0.06, -0.08, 0.03], initialRotation: [0.4, 1.8, 0.6], variant: 0 },
  // Mid-altitude wanderers
  { position: [-30, 70, 140], scale: 2.0, rotationSpeed: [0.05, 0.05, -0.04], initialRotation: [0.9, 0.9, 0.1], variant: 1 },
  { position: [140, -75, 40], scale: 1.4, rotationSpeed: [-0.03, 0.04, 0.07], initialRotation: [1.5, 0.2, 1.2], variant: 3 },
  { position: [-70, 90, -170], scale: 2.5, rotationSpeed: [0.07, -0.03, 0.05], initialRotation: [0.1, 0.5, 1.8], variant: 0 },
  { position: [40, -95, -190], scale: 3.0, rotationSpeed: [-0.06, 0.06, -0.03], initialRotation: [0.5, 2.2, 0.4], variant: 2 },
  { position: [-200, 60, -80], scale: 2.4, rotationSpeed: [0.04, 0.05, 0.08], initialRotation: [1.8, 0.1, 0.5], variant: 3 },
  { position: [210, -50, -30], scale: 1.6, rotationSpeed: [-0.05, -0.04, 0.05], initialRotation: [0.3, 0.8, 1.1], variant: 1 },
  // Deep-volume sentinels (high above / far below the ecliptic)
  { position: [70, 150, 90], scale: 2.6, rotationSpeed: [0.05, -0.04, 0.06], initialRotation: [0.7, 1.4, 0.3], variant: 0 },
  { position: [-120, 165, 60], scale: 1.9, rotationSpeed: [-0.04, 0.06, 0.03], initialRotation: [1.1, 0.6, 0.8], variant: 2 },
  { position: [90, 185, -60], scale: 3.2, rotationSpeed: [0.03, 0.05, -0.06], initialRotation: [0.2, 1.9, 1.4], variant: 3 },
  { position: [-60, -155, -110], scale: 2.3, rotationSpeed: [0.06, 0.04, 0.05], initialRotation: [1.6, 0.3, 0.7], variant: 1 },
  { position: [150, -170, 130], scale: 2.7, rotationSpeed: [-0.05, 0.03, 0.04], initialRotation: [0.9, 1.2, 0.5], variant: 0 },
  { position: [-40, -190, 80], scale: 1.7, rotationSpeed: [0.04, -0.05, 0.07], initialRotation: [2.0, 0.8, 1.0], variant: 2 },
];

/**
 * Scale tumble rate inversely with size, applied once at module load so there is
 * no per-frame cost.
 *
 * The hand-authored `rotationSpeed` values above all sit in the same 0.03-0.08
 * band while `scale` ranges 1.2 to 3.5 — so a 3.5-unit boulder tumbled exactly
 * as fast as a 1.2-unit chunk, which is the tell that made the field read
 * uniform and lifeless. Bigger bodies should turn more slowly.
 *
 * Normalised at scale 2.0 (roughly the median), so mid-sized rocks keep their
 * authored rate and only the extremes shift: the smallest speeds up ~1.7x, the
 * largest slows to ~0.57x. Signs and relative per-axis character are preserved,
 * so each rock keeps the tumble personality it was authored with.
 */
const TUMBLE_REF_SCALE = 2.0;
for (const a of asteroidInstances) {
  const f = TUMBLE_REF_SCALE / a.scale;
  a.rotationSpeed = [a.rotationSpeed[0] * f, a.rotationSpeed[1] * f, a.rotationSpeed[2] * f];
}

export const ASTEROID_COLLIDERS = asteroidInstances.map((a, i) => ({
  id: `asteroid_${i}`, x: a.position[0], y: a.position[1], z: a.position[2], r: a.scale * 2.2,
}));
export const SUN_COLLIDER = { id: "sol", x: 0, y: 0, z: 0, r: 4 };
