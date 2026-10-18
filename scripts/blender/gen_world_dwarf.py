# The salt-spotted dwarf (Ceres-type) world maps, painted texel-by-texel in numpy.
#   $BLENDER --background --python scripts/blender/gen_world_dwarf.py [-- --out=DIR]
#
# Original work: every texel is generated procedurally from a fixed seed, so a
# re-run reproduces the same pixels. Runs in Blender's Python for its bundled
# numpy and shares w-rock's grid, crater stamper, normal map and writer through
# surface_lib.py, so its relief is built and encoded as w-rock's is (the same
# material program in the game). Its height is softened isotropically on the
# sphere (soften_sphere) and harder than w-rock's, since a crater-saturated
# map carries far more detail into the same 90 KB WebP. It uses no bpy.
#
# Writes (spec docs/superpowers/specs/2026-10-17-new-worlds-design.md):
#   assets-src/w-dwarf.png         1024x512 sRGB albedo: dark neutral grey (a
#                                  C-type's flat spectrum), a few paler young
#                                  ejecta, brilliant salt faculae
#   assets-src/w-dwarf_normal.png  1024x512 tangent-space normal map (OpenGL,
#                                  +Y north): a crater-saturated surface like
#                                  Dawn's Ceres, polygonal large craters, a
#                                  shallow Occator and one lone steep mountain
#
# Both are painted on a 2048x1024 grid and box-filtered 2x2 to 1024x512, so
# the smallest craters stay smooth. The albedo's linear-luminance texel median
# is calibrated to TARGET_MEDIAN (spec "Light"); the faculae are laid on after
# calibration, since they are the brightest thing on Ceres, not scaled with it.
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from surface_lib import (Perlin, calibrate, crater_set, crater_stamper, dir_from, equirect_grid,  # noqa: E402
                         fbm, hexcol, lin_to_srgb, normal_map, smoothstep, soften_sphere, srgb_to_lin, warp,
                         write_png)

SEED = 20261117
W, H = 2048, 1024           # painting grid
TARGET_MEDIAN = 0.016       # linear luminance (tests/worldMaps.test.ts)
FACULA_PEAK = 0.16          # linear: Cerealia's core, about 10x the median
NORMAL_STRENGTH = 6.0       # stronger than w-rock_normal's 3, softer (below): Ceres's craters are its whole look
NORMAL_SOFTEN_PX = 2.8      # isotropic on the sphere: a crater-saturated map fits the 90 KB cap,
                            # < 2.6 RMS codec error and the < 5 seam only this soft

P, window, local_polar = equirect_grid(W, H)
stamp_crater = crater_stamper(P, window, local_polar)

OCCATOR = dir_from(20, 239)
OCCATOR_R = 0.1             # 92 km across on a 470 km body
AHUNA = dir_from(-10.5, 316)
AHUNA_R = 0.026             # ~25 km base: Ahuna's 17 km, a little larger so
                            # its relief survives the normal map's softening


def box2(a):
    """2x2 box filter of an (H, W[, C]) array."""
    h, w = a.shape[:2]
    return a.reshape(h // 2, 2, w // 2, 2, *a.shape[2:]).mean(axis=(1, 3))


def patches(Ps, c, radius, noise, freq, cut, seed):
    """Irregular bright patches in a disc around c: thresholded, warped noise
    under a soft envelope, so the edge is ragged, never a round dot."""
    ang, _ = local_polar(Ps, c)
    env = np.exp(-(ang / radius) ** 2)
    n = fbm(noise, warp(noise, Ps + np.float32(seed), freq * 0.5, 0.004) + np.float32(seed), freq, 4)
    return smoothstep(cut, cut + 0.2, env + 0.6 * n)


def ceres():
    rng = np.random.default_rng(SEED + 1)
    nz = Perlin(SEED + 2)
    Hm = 0.006 * fbm(nz, P, 2.0, 6)
    wall = np.zeros_like(Hm)      # albedo: + rims and fresh walls, slightly - floors

    def sides():
        return int(rng.integers(5, 8)), float(rng.uniform(0, 2 * math.pi))

    # the oldest, relaxed basins (Kerwan-, Yalode-, Urvara-like): wide and shallow
    for c, r in [(dir_from(-11, 124), 0.30), (dir_from(-42, 293), 0.27), (dir_from(-46, 249), 0.18)]:
        n, t = sides()
        stamp_crater(Hm, c, r, depth=r * 0.05, rim=r * 0.012, noise=nz, floor_frac=0.7, erase=0.5,
                     irregular=0.1, ext=1.6, ejecta=3.0, poly=0.12, sides=n, turn=t)
    # a saturated population across sizes (power law), oldest and largest first,
    # so later craters overprint earlier ones; the large ones polygonal
    for c, r in crater_set(rng, 80, 0.06, 0.16, 1.8):
        n, t = sides()
        idx, x, az, Ps = stamp_crater(Hm, c, r, depth=r * 0.13, rim=r * 0.035, noise=nz, floor_frac=0.55,
                                      peak=r * 0.05, erase=0.8, irregular=0.09, poly=0.16, sides=n, turn=t)
        wall[idx] += 0.1 * np.exp(-((x - 0.92) / 0.1) ** 2)
    for c, r in crater_set(rng, 1200, 0.025, 0.06, 2.0):
        n, t = sides()
        idx, x, az, Ps = stamp_crater(Hm, c, r, depth=r * 0.2, rim=r * 0.055, noise=nz,
                                      floor_frac=0.4 if r > 0.035 else 0.0, peak=r * 0.05 if r > 0.04 else 0.0,
                                      poly=0.1 if r > 0.035 else 0.0, sides=n, turn=t)
        wall[idx] += 0.1 * np.exp(-((x - 0.92) / 0.12) ** 2)
    for c, r in crater_set(rng, 900, 0.016, 0.028, 2.3):
        idx, x, az, Ps = stamp_crater(Hm, c, r, depth=r * 0.24, rim=r * 0.065, noise=nz, ext=2.2)
        wall[idx] += 0.11 * np.exp(-((x - 0.95) / 0.15) ** 2)
    # the smallest craters, below what the softened normal map can carry, as
    # albedo only: paler fresh rims over slightly darker floors (sub-km on Ceres)
    for c, r in crater_set(np.random.default_rng(SEED + 3), 3000, 0.005, 0.016, 2.2):
        idx = window(c, r * 1.6)
        ang, _ = local_polar(P[idx], c)
        x = ang / r
        wall[idx] += 0.14 * np.exp(-((x - 1.0) / 0.2) ** 2) - 0.06 * (1 - smoothstep(0.6, 0.9, x))

    # young craters with paler, bluish ejecta (Haulani-, Oxo-like)
    fresh = np.zeros_like(Hm)
    for c, r in [(dir_from(6, 11), 0.035), (dir_from(42, 359), 0.012), (dir_from(-48, 140), 0.022)]:
        idx, x, az, Ps = stamp_crater(Hm, c, r, depth=r * 0.25, rim=r * 0.07, noise=nz, floor_frac=0.3, ext=4.0)
        ej = np.exp(-np.maximum(x - 0.9, 0) * 1.6) * (0.55 + 0.45 * smoothstep(-0.2, 0.4, fbm(nz, Ps, 40.0, 3)))
        fresh[idx] = np.maximum(fresh[idx], ej)

    # Occator: a fresh polygonal crater, shallow (4 km on 92 km) with a wide
    # flat floor and a low central dome (Cerealia Tholus) under the salt
    idx, x, az, Ps = stamp_crater(Hm, OCCATOR, OCCATOR_R, depth=OCCATOR_R * 0.12, rim=OCCATOR_R * 0.04, noise=nz,
                                  floor_frac=0.75, erase=0.95, irregular=0.06, poly=0.22, sides=6, turn=0.3)
    wall[idx] += 0.06 * np.exp(-((x - 0.9) / 0.1) ** 2)
    Hm[idx] += OCCATOR_R * 0.02 * np.exp(-(x / 0.12) ** 2)

    # Ahuna Mons: one lone steep dome with a flat, fissured top
    idx = window(AHUNA, AHUNA_R * 1.6)
    Ps = P[idx]
    ang, az = local_polar(Ps, AHUNA)
    xr = ang / (AHUNA_R * (1.0 + 0.08 * nz(Ps * 120.0)))
    top = 1.0 - smoothstep(0.5, 1.0, xr)
    crack = 0.08 * np.clip(fbm(nz, Ps + 4.4, 160.0, 3, ridged=True), 0, None) * (1 - smoothstep(0.3, 0.5, xr))
    Hm[idx] = Hm[idx] * (1 - top) + AHUNA_R * 0.55 * (top - crack)

    # albedo (sRGB): dark neutral grey, faint large-scale variation, paler rims
    base = hexcol("#555556")
    var = 1.0 + 0.06 * fbm(nz, P + 3.3, 2.0, 5) + 0.03 * fbm(nz, P + 8.1, 14.0, 3)
    alb = base * (var * (1.0 + np.clip(wall, -0.08, 0.2)))[..., None]
    alb = alb + (hexcol("#8d939c") - alb) * (0.6 * fresh)[..., None]

    # salt (bright faculae), laid on after calibration
    salt = np.zeros_like(Hm)
    idx = window(OCCATOR, OCCATOR_R)
    Ps = P[idx]
    # Cerealia: the central bright patch over the dome, lobed and ragged
    salt[idx] = np.maximum(salt[idx], patches(Ps, OCCATOR, 0.018, nz, 150.0, 0.25, 1.0))
    # Vinalia: scattered smaller, fainter patches across the eastern floor,
    # each its own ragged spot (never a dark pit: the floor around stays as is)
    srng = np.random.default_rng(SEED + 4)
    east = np.cross([0.0, 1.0, 0.0], OCCATOR)
    east = east / np.linalg.norm(east)
    north = np.cross(OCCATOR, east)
    for k in range(9):
        d = OCCATOR_R * float(srng.uniform(0.25, 0.75))
        a = float(srng.normal(0, 0.8))          # azimuth from east, toward north
        c = (math.cos(d) * OCCATOR + math.sin(d) * (math.cos(a) * east + math.sin(a) * north)).astype(np.float32)
        salt[idx] = np.maximum(salt[idx], float(srng.uniform(0.45, 0.8))
                               * patches(Ps, c, OCCATOR_R * float(srng.uniform(0.05, 0.1)), nz, 250.0, 0.3, 7.0 + k))
    # fainter bright spots elsewhere (Oxo-like, and a few small crater-floor deposits)
    spots = [((42, 359), 0.009, 0.45), ((6, 11), 0.01, 0.35), ((-48, 140), 0.007, 0.3),
             ((33, 52), 0.007, 0.25), ((-24, 205), 0.007, 0.25), ((61, 170), 0.006, 0.2)]
    for k, ((la, lo), rad, amp) in enumerate(spots):
        c = dir_from(la, lo)
        idx = window(c, rad * 3)
        salt[idx] = np.maximum(salt[idx], amp * patches(P[idx], c, rad, nz, 300.0, 0.4, 3.0 + k))
    # Ahuna's bright streaks down its flanks
    idx = window(AHUNA, AHUNA_R * 1.2)
    Ps = P[idx]
    ang, az = local_polar(Ps, AHUNA)
    xr = ang / AHUNA_R
    streak = smoothstep(0.2, 0.75, nz(np.stack([np.cos(az) * 6, np.sin(az) * 6, np.full_like(az, 2.5)], -1)))
    salt[idx] = np.maximum(salt[idx], 0.3 * streak * smoothstep(0.45, 0.7, xr) * smoothstep(1.05, 0.85, xr))
    return Hm, alb, salt


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opt = dict(a[2:].split("=", 1) for a in argv if a.startswith("--") and "=" in a)
    out = os.path.abspath(opt.get("out", os.path.join(os.path.dirname(__file__), "..", "..", "assets-src")))
    os.makedirs(out, exist_ok=True)
    Hm, alb, salt = ceres()
    srgb, s = calibrate(box2(alb), TARGET_MEDIAN)
    print(f"w-dwarf: albedo scale {s:.4f}")
    lin = srgb_to_lin(srgb)
    a = np.clip(box2(salt), 0, 1)[..., None]
    write_png(os.path.join(out, "w-dwarf.png"), lin_to_srgb(lin + (FACULA_PEAK - lin) * a))
    Hn = soften_sphere(box2(Hm - float(Hm.mean())), NORMAL_SOFTEN_PX)
    write_png(os.path.join(out, "w-dwarf_normal.png"), normal_map(Hn, NORMAL_STRENGTH))


main()
