import * as THREE from "three";

/**
 * Soft round sprite for point particles, so they read as glow or dust rather
 * than the hard squares PointsMaterial draws without a map. Shared: comet
 * tails, engine exhaust and near-field dust all use the same texture (and so
 * the same compiled program).
 */
export const softSprite = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
  }
  return new THREE.CanvasTexture(canvas);
})();
