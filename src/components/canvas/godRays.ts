/**
 * What postprocessing's GodRaysEffect forces onto its light source's material
 * (its `lightSource` setter). The sun's core is built in this state from the
 * start, so ShaderWarmup compiles the program it will actually draw with.
 * Built opaque, the sun compiled a second program the first time it was drawn
 * whenever PostFX mounted after warm-up. tests/godRaysSource.test.ts checks
 * this against the real effect.
 */
export const GOD_RAYS_SOURCE_FLAGS = { transparent: true, depthWrite: false } as const;
