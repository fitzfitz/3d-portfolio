/**
 * Seeded layout for the distant-galaxy sprites (DistantGalaxies.tsx). Pure, so
 * it is testable without a canvas: the component paints the plan. Coordinates
 * and radii are in units of the texture half-size, so the plan always fits.
 */
export type GalaxyKind = "spiral" | "inclined" | "elliptical";

export interface GalaxyDot { x: number; y: number; r: number; alpha: number; hue: number; light: number }

export interface GalaxyPlan {
  kind: GalaxyKind;
  arms: number;
  /** Vertical scale applied to the whole galaxy: 1 is face-on. */
  squash: number;
  /** Bulge radius (half-size units). */
  bulge: number;
  /** Stars and star-forming knots, painted additively. */
  dots: GalaxyDot[];
  /** Dust, painted with destination-out along the inner edge of each arm. */
  lanes: GalaxyDot[];
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_R = 0.94; // soft margin: nothing touches the sprite edge, so no hard rim shows

function clampToDisc(x: number, y: number, r: number): [number, number] {
  const d = Math.hypot(x, y);
  const limit = MAX_R - r;
  return d > limit ? [(x / d) * limit, (y / d) * limit] : [x, y];
}

export function planGalaxy(seed: number, kind: GalaxyKind, hueBase: number): GalaxyPlan {
  const rand = mulberry32(seed);
  const dots: GalaxyDot[] = [];
  const lanes: GalaxyDot[] = [];
  const push = (list: GalaxyDot[], x: number, y: number, d: Omit<GalaxyDot, "x" | "y">) => {
    const [cx, cy] = clampToDisc(x, y, d.r);
    list.push({ x: cx, y: cy, ...d });
  };

  if (kind === "elliptical") {
    const squash = 0.6 + rand() * 0.25;
    for (let i = 0; i < 1400; i++) {
      // Roughly Gaussian radius: dense core, long faint fall-off.
      const g = (rand() + rand() + rand() - 1.5) / 1.5;
      const rr = Math.min(Math.abs(g) * 0.55, 0.85);
      const a = rand() * Math.PI * 2;
      push(dots, Math.cos(a) * rr, Math.sin(a) * rr * squash, {
        r: 0.003 + rand() * 0.004, alpha: 0.5 * (1 - rr), hue: 35 + rand() * 20, light: 78 - rr * 20,
      });
    }
    return { kind, arms: 0, squash, bulge: 0.35 + rand() * 0.1, dots, lanes };
  }

  const arms = 2 + Math.floor(rand() * 3);
  const squash = kind === "inclined" ? 0.45 + rand() * 0.2 : 1;
  const wind = 3.6 + rand() * 1.2;
  const perArm = Math.round(1800 / arms);
  for (let arm = 0; arm < arms; arm++) {
    const off = (arm / arms) * Math.PI * 2 + (rand() - 0.5) * 0.3;
    for (let p = 0; p < perArm; p++) {
      const t = p / perArm;
      const ang = off + t * wind + (rand() - 0.5) * 0.42;
      const rr = 0.06 + t * 0.82 * (0.92 + rand() * 0.16);
      const knot = p % 60 === 0 && t > 0.2; // star-forming knot: a tight pink cluster
      const n = knot ? 6 : 1;
      for (let k = 0; k < n; k++) {
        const jx = knot ? (rand() - 0.5) * 0.03 : 0;
        const jy = knot ? (rand() - 0.5) * 0.03 : 0;
        push(dots, Math.cos(ang) * rr + jx, (Math.sin(ang) * rr + jy) * squash, {
          r: knot ? 0.004 + rand() * 0.003 : 0.003 + rand() * 0.005,
          alpha: knot ? 0.7 : 0.5 * (1 - t),
          hue: knot ? 330 + rand() * 15 : hueBase + rand() * 40,
          light: knot ? 75 : 72 - t * 25,
        });
      }
      if (p % 4 === 0 && t > 0.08 && t < 0.85) {
        const la = ang - 0.16; // just inside the arm
        push(lanes, Math.cos(la) * rr * 0.97, Math.sin(la) * rr * 0.97 * squash, {
          r: 0.008 + rand() * 0.008, alpha: 0.12, hue: 0, light: 0,
        });
      }
    }
  }
  return { kind, arms, squash, bulge: 0.1 + rand() * 0.06, dots, lanes };
}
