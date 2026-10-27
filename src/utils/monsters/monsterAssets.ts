/**
 * Where the space monsters' models live: loose files in public/models-ondemand,
 * outside public/models, so no asset pack (the startup download, vite.config.ts)
 * carries them. Only the Nest's load gate and the dev monster lab fetch them,
 * through assetUrl; the service worker caches them by its same-origin rule.
 */
export const SAUCER_GLB = "/models-ondemand/saucer.glb";
export const TARDIGRADE_GLB = "/models-ondemand/tardigrade.glb";
