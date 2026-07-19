export interface AsteroidData {
  position: [number, number, number];
  scale: number;
  rotationSpeed: [number, number, number];
  initialRotation: [number, number, number];
  /** which sculpted mesh in asteroids.glb: 0 boulder, 1 shard, 2 contact binary, 3 rubble chunk */
  variant: 0 | 1 | 2 | 3;
}

export const asteroidInstances: AsteroidData[] = [
  { position: [-40, -5, -60], scale: 1.5, rotationSpeed: [0.08, 0.05, 0.03], initialRotation: [0.2, 0.5, 0.1], variant: 0 },
  { position: [60, 2, 70], scale: 2.2, rotationSpeed: [-0.05, 0.08, 0.04], initialRotation: [1.2, 0.2, 0.5], variant: 1 },
  { position: [-90, -10, -20], scale: 1.2, rotationSpeed: [0.04, -0.06, 0.08], initialRotation: [0.5, 1.1, 0.2], variant: 3 },
  { position: [80, 5, -120], scale: 2.8, rotationSpeed: [0.03, 0.04, -0.05], initialRotation: [0.8, 0.3, 0.9], variant: 2 },
  { position: [-160, 3, 20], scale: 3.5, rotationSpeed: [-0.04, 0.03, 0.06], initialRotation: [2.1, 0.4, 0.2], variant: 2 },
  { position: [110, -8, 120], scale: 1.8, rotationSpeed: [0.06, -0.08, 0.03], initialRotation: [0.4, 1.8, 0.6], variant: 0 },
  { position: [-30, 6, 140], scale: 2.0, rotationSpeed: [0.05, 0.05, -0.04], initialRotation: [0.9, 0.9, 0.1], variant: 1 },
  { position: [140, -4, 40], scale: 1.4, rotationSpeed: [-0.03, 0.04, 0.07], initialRotation: [1.5, 0.2, 1.2], variant: 3 },
  { position: [-70, 0, -170], scale: 2.5, rotationSpeed: [0.07, -0.03, 0.05], initialRotation: [0.1, 0.5, 1.8], variant: 0 },
  { position: [40, -2, -190], scale: 3.0, rotationSpeed: [-0.06, 0.06, -0.03], initialRotation: [0.5, 2.2, 0.4], variant: 2 },
  { position: [-200, 4, -80], scale: 2.4, rotationSpeed: [0.04, 0.05, 0.08], initialRotation: [1.8, 0.1, 0.5], variant: 3 },
  { position: [210, -6, -30], scale: 1.6, rotationSpeed: [-0.05, -0.04, 0.05], initialRotation: [0.3, 0.8, 1.1], variant: 1 },
];

export const ASTEROID_COLLIDERS = asteroidInstances.map((a, i) => ({
  id: `asteroid_${i}`, x: a.position[0], y: a.position[1], z: a.position[2], r: a.scale * 2.2,
}));
export const SUN_COLLIDER = { id: "sol", x: 0, y: 0, z: 0, r: 4 };
