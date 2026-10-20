/**
 * Depth across the whole system (real-solar-system spec §6.2, Task 9).
 *
 * The camera sees from 0.1 u (the ship's own hull) to CAMERA_FAR, past the
 * far side of the 3,600 u system. A plain depth buffer spends its precision
 * near the camera: at 1,500 u it resolves only a few units, so Earth's cloud
 * shell (1.03 R, 0.25 u above the ground) shredded into triangles against the
 * surface (Task 9 spike). The renderer runs a logarithmic depth buffer
 * instead (GlobalCanvas `logarithmicDepthBuffer`), whose resolution is a
 * constant fraction of the distance at every range, in both render tiers.
 *
 * Why not a reversed depth buffer (tried first): measured on Chrome's
 * ANGLE/Metal backend, the low-perf tier (drawn straight to the antialiased
 * canvas) drew no depth-tested object at all with it on; and it gains only
 * with a float depth attachment, which the composer's 24-bit renderbuffer is
 * on Apple GPUs (Metal stores it as float) but not on most others.
 * The cost: every fragment writes gl_FragDepth, which turns off early depth
 * rejection. Measured A/B at five views (M5, 1280×800, Task 9 ledger): about
 * +0.06 ms a frame with PostFX (2.0 ms), +0.12 ms in low-perf (1.1 ms).
 *
 * Built-in materials write the log depth themselves (three's logdepthbuf
 * chunks). Every custom ShaderMaterial that is depth-tested against the scene
 * must too, or its plain hyperbolic depth is compared with the log values in
 * the buffer and it hides behind things far beyond it: its vertex shader adds
 * LOG_DEPTH_VERT_PARS before main and LOG_DEPTH_VERT after writing
 * gl_Position; its fragment shader LOG_DEPTH_FRAG_PARS and, in main,
 * LOG_DEPTH_FRAG. With the buffer off they compile to nothing.
 * tests/logDepth.test.ts checks every shader in src.
 */

/** The camera's far plane (u): the system is 7,200 across (SYSTEM_RADIUS 3,600). */
export const CAMERA_FAR = 8000;

/** The renderer's depth mode (GlobalCanvas gl props). */
export const LOG_DEPTH_BUFFER = true;

export const LOG_DEPTH_VERT_PARS = /* glsl */ `#include <logdepthbuf_pars_vertex>`;

/**
 * three's <logdepthbuf_vertex>, with isPerspectiveMatrix (from <common>,
 * which most of these shaders do not include) written out.
 */
export const LOG_DEPTH_VERT = /* glsl */ `
  #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
    vFragDepth = 1.0 + gl_Position.w;
    vIsPerspective = float( projectionMatrix[ 2 ][ 3 ] == - 1.0 );
  #endif
`;

export const LOG_DEPTH_FRAG_PARS = /* glsl */ `#include <logdepthbuf_pars_fragment>`;

/** Writes gl_FragDepth from the varyings only, so it may stand anywhere in main. */
export const LOG_DEPTH_FRAG = /* glsl */ `#include <logdepthbuf_fragment>`;
