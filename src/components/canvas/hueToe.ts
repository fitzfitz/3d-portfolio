import { ShaderChunk } from "three";

/**
 * A hue-keeping toe for three's PBR Neutral tone mapper (owner's pick,
 * 2026-10-21, after a measured comparison against the knee and AgX).
 *
 * three r185's NeutralToneMapping lifts its toe with `color -= offset`, the
 * same amount off every channel. In a dark warm grey the smallest channel is
 * blue, so blue is crushed and the hue swings: Venus (b/g 0.84 untoned) read
 * 0.54 and Saturn (0.70) read 0.32, both olive. Taking the same offset off
 * the peak channel as a scale keeps the channel ratios: Venus measured 0.82
 * and Saturn 0.71. The peak, which the shoulder reads next, comes out exactly
 * as before (peak − offset), so bright colours, the Sun and the neon are
 * unchanged.
 *
 * The chunk is resolved when a program compiles, so this must run before the
 * first one: GlobalCanvas imports it first, which covers the composer's
 * ToneMapping pass, the renderer's own tone mapping in low-perf and the
 * shader warm-up alike. The shader source a material hands three keeps its
 * `#include`, so program cache keys, and the program count, do not change.
 * Idempotent: once replaced, the old line is gone. A three upgrade that
 * rewrites the line makes the replace a no-op; tests/hueToe.test.ts fails then.
 */
export const NEUTRAL_TOE = "\tcolor -= offset;";
export const HUE_KEEPING_TOE = "\tcolor *= 1. - offset / max( max( color.r, max( color.g, color.b ) ), 1e-6 );";

export function patchHueToe(): void {
  ShaderChunk.tonemapping_pars_fragment = ShaderChunk.tonemapping_pars_fragment.replace(NEUTRAL_TOE, HUE_KEEPING_TOE);
}

patchHueToe();
