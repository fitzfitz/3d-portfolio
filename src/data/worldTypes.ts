import { fluxEarth, equilibriumTempK } from "../utils/worldPhysics";

/**
 * The world-type law (spec "Built to scale", rule 1): each type declares the
 * physical conditions it needs as functions of its orbit, and
 * tests/worldTypes.test.ts fails if a world in WORLDS sits where its type
 * cannot exist. Thresholds are approximate where the science is.
 *
 * venus-type and nitrogen-dwarf have no world in the roster; they exist so the
 * law can reject them (no Venus-type fits inside ~109 u, no Pluto-type inside
 * the system edge).
 */
export type WorldTypeId = "airless-rock" | "ringed-giant" | "ice-giant" | "salt-dwarf" | "venus-type" | "nitrogen-dwarf";

export interface Verdict { ok: boolean; reason: string }
export interface WorldType {
  label: string;
  canExistAt(r: number, bondAlbedo: number): Verdict;
}

/** Runaway greenhouse sets in above ~1.1 S⊕ (approximate; Kopparapu et al. 2013, ApJ 765:131, inner habitable-zone edge). */
const RUNAWAY_FLUX = 1.1;
/** Nitrogen ice needs T_eq ≤ ~60 K (approximate; N₂ triple point 63.15 K). */
const N2_ICE_MAX_K = 60;
/** Water-ice rings survive at T_eq ≤ ~170 K (approximate; water ice sublimates fast above ~170 K in vacuum). */
const RING_ICE_MAX_K = 170;
/** A Ceres-like dwarf keeps subsurface water ice at T_eq ≤ ~180 K (approximate; real Ceres ~166 K, Dawn found ice below its surface). */
const SALT_DWARF_MAX_K = 180;

const fmt = (x: number) => x.toFixed(1);

export const WORLD_TYPES: Record<WorldTypeId, WorldType> = {
  "airless-rock": {
    label: "AIRLESS ROCK",
    canExistAt: () => ({ ok: true, reason: "an airless rock has no atmosphere or ice to lose, so it can sit at any distance" }),
  },
  "ice-giant": {
    label: "ICE GIANT",
    canExistAt: () => ({ ok: true, reason: "forms beyond the frost line and may migrate, so it can sit at any distance" }),
  },
  "ringed-giant": {
    label: "RINGED GIANT",
    canExistAt(r, a) {
      const t = equilibriumTempK(r, a);
      return t <= RING_ICE_MAX_K
        ? { ok: true, reason: `T_eq ${fmt(t)} K ≤ ~${RING_ICE_MAX_K} K: its water-ice rings survive` }
        : { ok: false, reason: `T_eq ${fmt(t)} K > ~${RING_ICE_MAX_K} K: water-ice rings would sublimate` };
    },
  },
  "salt-dwarf": {
    label: "SALT-SPOTTED DWARF",
    canExistAt(r, a) {
      const t = equilibriumTempK(r, a);
      return t <= SALT_DWARF_MAX_K
        ? { ok: true, reason: `T_eq ${fmt(t)} K ≤ ~${SALT_DWARF_MAX_K} K: water ice survives below its surface` }
        : { ok: false, reason: `T_eq ${fmt(t)} K > ~${SALT_DWARF_MAX_K} K: too warm for subsurface water ice` };
    },
  },
  "venus-type": {
    label: "VENUS-TYPE",
    canExistAt(r) {
      const s = fluxEarth(r);
      return s >= RUNAWAY_FLUX
        ? { ok: true, reason: `${s.toFixed(2)} S⊕ ≥ ~${RUNAWAY_FLUX} S⊕: a runaway greenhouse can run` }
        : { ok: false, reason: `${s.toFixed(2)} S⊕ < ~${RUNAWAY_FLUX} S⊕: too little sunlight for a runaway greenhouse` };
    },
  },
  "nitrogen-dwarf": {
    label: "NITROGEN-ICE DWARF",
    canExistAt(r, a) {
      const t = equilibriumTempK(r, a);
      return t <= N2_ICE_MAX_K
        ? { ok: true, reason: `T_eq ${fmt(t)} K ≤ ~${N2_ICE_MAX_K} K: nitrogen ice holds` }
        : { ok: false, reason: `T_eq ${fmt(t)} K > ~${N2_ICE_MAX_K} K: nitrogen ice would not survive` };
    },
  },
};
