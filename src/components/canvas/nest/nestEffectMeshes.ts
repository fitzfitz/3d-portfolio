import type * as THREE from "three";

/** The Nest's effect meshes (NestEffects), for the renderer's debug handle (fitzDebug.nestRender.effects); filled in dev only. */
export const nestEffectMeshes: { meshes: (THREE.InstancedMesh | THREE.Points)[] } = { meshes: [] };
