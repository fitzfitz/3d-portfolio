# The airless rock (Mercury-type) world maps, painted texel-by-texel in numpy.
#   $BLENDER --background --python scripts/blender/gen_world_rock.py [-- --out=DIR]
#
# Original work: every texel is generated procedurally from a fixed seed (no
# Cycles bake, no sampling noise), so a re-run reproduces the same pixels.
# Runs in Blender's Python for its bundled numpy, like gen_moon.py: it shares
# that script's noise, crater and ray code through surface_lib.py and ports its
# maria (here on surface_lib's 2:1 equirect_grid). It uses no bpy.
#
# Writes (spec docs/superpowers/specs/2026-10-17-new-worlds-design.md):
#   assets-src/w-rock.png         2048x1024 sRGB albedo: grey-brown; one large
#                                 basin (Caloris-like) with a ring of massifs,
#                                 smooth plains, darker low-reflectance patches,
#                                 rayed young craters, lobate scarps
#   assets-src/w-rock_normal.png  1024x512 tangent-space normal map (OpenGL,
#                                 +Y north), the height field's full relief
#
# Grid convention matches THREE.SphereGeometry and gen_planets.mjs: row 0 is
# the north pole, for texel (u, v) phi = u * 2PI and lat = PI/2 - v * PI,
#   x = -cos(phi) cos(lat),  y = sin(lat),  z = sin(phi) cos(lat).
# The albedo's linear-luminance texel median is calibrated to TARGET_MEDIAN
# (spec "Light": honest albedo on the scene's scale).
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from surface_lib import (Perlin, calibrate, crater_set, crater_stamper, dir_from, equirect_grid,  # noqa: E402
                         fbm, hexcol, normal_map, smoothstep, soften, unit, voronoi, warp,
                         write_png)

SEED = 20261017
W, H = 2048, 1024
NW, NH = 1024, 512          # normal map size
TARGET_MEDIAN = 0.025       # linear luminance (tests/worldMaps.test.ts)
NORMAL_STRENGTH = 3.0       # relief exaggeration in the normal map
NORMAL_SOFTEN_PX = 1.2      # pre-blur of the normal map's height, texels

P, window, local_polar = equirect_grid(W, H)
stamp_crater = crater_stamper(P, window, local_polar)


# ------------------------------------------------------------------ the world
def lobate_scarp(Hm, rng, noise, height, length):
    """A thrust-fault cliff along a wandering great-circle arc: a steep face, a long gentle back slope."""
    nrm = unit(rng)
    a = np.cross(nrm, unit(rng))
    a = (a / np.linalg.norm(a)).astype(np.float32)
    b = np.cross(nrm, a).astype(np.float32)
    th0 = float(rng.uniform(-math.pi, math.pi))
    th = np.arctan2(P @ b, P @ a)
    dth = np.mod(th - th0, 2 * math.pi)
    along = smoothstep(0.0, 0.12, dth) * (1 - smoothstep(length - 0.12, length, dth)) * (dth < length)
    s = np.arcsin(np.clip(P @ nrm, -1, 1)) + 0.012 * fbm(noise, P + float(th0), 7.0, 3)   # lobate wander
    face = smoothstep(-0.004, 0.0, s) * np.exp(-np.maximum(s, 0) / 0.035)
    Hm += height * face * along


def ray_system(c, r, reach, n, rng, noise, skew=0.0, bundles=0):
    """MESSENGER-like rays of a young crater: n long, thin, high-contrast
    streaks along great circles out of c, each its own length (up to `reach`
    rad), broad where they leave the ejecta blanket, then thin and slowly
    widening, broken into patches along their length. Never thinner than
    about one texel, so a ray survives the 2048 map and the WebP encode.
    `skew` is the share of rays bunched around one azimuth (an oblique
    impact's lopsided pattern). `bundles` > 0 (the big Hokusai-like systems)
    clusters the azimuths into that many uneven sprays, each with its own
    spread, share of rays, reach, width and brightness, rather than a
    regular starburst; those rays fade with distance and lose whole stretches
    where later terrain interrupts them. Returns (window index, brightness 0..1)."""
    idx = window(c, reach)
    Ps = P[idx]
    ang, az = local_polar(Ps, c)
    sa = np.sin(ang)
    out = np.zeros(ang.shape, np.float32)
    downrange = float(rng.uniform(-math.pi, math.pi))
    if bundles:
        b_az = rng.uniform(-math.pi, math.pi, bundles)
        b_spread = rng.uniform(0.04, 0.2, bundles)          # rad: a tight jet to a loose spray
        b_share = rng.dirichlet(np.full(bundles, 1.5))       # some sprays carry most rays
        b_reach = rng.uniform(0.75, 1.0, bundles)
        b_wide = rng.uniform(0.7, 1.8, bundles)
        b_amp = rng.uniform(0.7, 1.0, bundles)
    for _ in range(n):
        if bundles:
            k = int(rng.choice(bundles, p=b_share))
            a0 = float(b_az[k]) + float(rng.normal(0, b_spread[k]))
            L = reach * float(b_reach[k]) * float(rng.uniform(0.6, 1.0))
            w0 = max(0.0022, r * float(rng.uniform(0.06, 0.2)) * float(b_wide[k]))
            amp = float(b_amp[k]) * float(rng.uniform(0.6, 1.0))
        else:
            a0 = downrange + float(rng.normal(0, 0.8)) if rng.uniform() < skew else float(rng.uniform(-math.pi, math.pi))
            L = reach * max(0.25, float(rng.uniform()) ** 0.9)         # many short, a few very long
            w0 = max(0.0022, r * float(rng.uniform(0.08, 0.2))) * (2.0 if rng.uniform() < 0.15 else 1.0)   # a few broad ones
            amp = float(rng.uniform(0.65, 1.0))
        da = np.mod(az - a0 + math.pi, 2 * math.pi) - math.pi
        d = sa * np.sin(np.clip(da, -1.2, 1.2))                   # off-ray distance, rad
        wid = w0 * (1.0 + 1.5 * ang / L + 2.0 * np.exp(-ang / (4 * r)))
        along = smoothstep(r * 0.8, r * 1.6, ang) * (1.0 - smoothstep(0.2 * L, L, ang)) * (np.abs(da) < 1.2)
        if bundles:
            along = along * np.exp(-0.6 * ang / L)                # fades with distance
        out = np.maximum(out, amp * along * np.exp(-(d / wid) ** 2))
    # patchy along each ray (secondary-crater chains), never a smooth spoke
    q = Ps + np.float32(r * 100)
    brk = smoothstep(-0.2, 0.3, fbm(noise, q, 9.0, 4)) * (0.45 + 0.55 * smoothstep(-0.2, 0.3, fbm(noise, q, 34.0, 3)))
    if bundles:      # whole stretches gone, ~0.1-0.2 rad across, beyond the ejecta
        gap = smoothstep(-0.25, 0.0, fbm(noise, q + 5.0, 5.0, 3))
        brk = brk * np.maximum(gap, 1.0 - smoothstep(3 * r, 6 * r, ang))
    return idx, np.minimum(1.0, 1.3 * out * (0.3 + 0.7 * brk))


def mercury():
    rng = np.random.default_rng(SEED + 1)
    nz = Perlin(SEED + 2)
    Hm = 0.008 * fbm(nz, P, 2.2, 6) + 0.0012 * fbm(nz, P, 22.0, 4)
    wall = np.zeros_like(Hm)      # albedo: + bright crater walls/rims, - dark floors

    # epoch 1: the one large basin (Caloris-like) and a saturated crater population
    bc, br = dir_from(31, 162), 0.33
    stamp_crater(Hm, bc, br, depth=0.026, rim=0.007, noise=nz, floor_frac=0.6, erase=0.6,
                 irregular=0.1, ext=1.9, ejecta=2.5)
    idx = window(bc, br * 1.5)
    Ps = P[idx]
    xb = np.arccos(np.clip(Ps @ bc, -1, 1)) / br
    massif = np.clip(fbm(nz, Ps + 3.3, 26.0, 4, ridged=True), 0, None)          # blocky ring of mountains
    Hm[idx] += 0.006 * massif * np.exp(-((xb - 1.02) / 0.07) ** 2)
    for c, r in crater_set(rng, 14, 0.08, 0.22, 1.6):
        idx, x, az, Ps = stamp_crater(Hm, c, r, depth=r * 0.13, rim=r * 0.04, noise=nz, floor_frac=0.62,
                                      peak=r * 0.06, irregular=0.08, erase=0.75)
        wall[idx] += 0.04 * np.exp(-((x - 0.85) / 0.1) ** 2) - 0.02 * (x < 0.75)
    for c, r in crater_set(rng, 160, 0.025, 0.08, 2.2):
        idx, x, az, Ps = stamp_crater(Hm, c, r, depth=r * 0.2, rim=r * 0.06, noise=nz,
                                      floor_frac=0.35 if r > 0.045 else 0.0, peak=r * 0.05 if r > 0.05 else 0.0)
        wall[idx] += 0.03 * np.exp(-((x - 0.85) / 0.12) ** 2)
    for c, r in crater_set(rng, 1500, 0.006, 0.025, 2.4):
        stamp_crater(Hm, c, r, depth=r * 0.24, rim=r * 0.07, noise=nz, ext=2.2)

    # smooth plains (the maria port): lava floods the basin floor and the high
    # northern plains; on Mercury they are a little brighter, not darker
    edge = 0.25 * fbm(nz, P, 3.2, 5) + 0.1 * fbm(nz, P + 1.7, 9.0, 3)
    d = np.arccos(np.clip(P @ bc, -1, 1)) / br
    plains = 1.0 - smoothstep(0.82, 0.95, d + edge)
    north = smoothstep(0.80, 0.86, P[..., 1] + 0.18 * edge + 0.08 * fbm(nz, P + 6.2, 2.0, 4))
    blob = fbm(nz, P + 9.1, 1.4, 5) + 0.6 * edge
    plains = np.maximum(np.maximum(plains, north), smoothstep(0.24, 0.29, blob))
    Hm = Hm * (1.0 - 0.85 * plains) - 0.003 * plains
    wall *= (1 - plains)
    wr = fbm(nz, P + 2.2, 7.0, 3, ridged=True)                 # wrinkle ridges on the plains
    Hm += 0.0014 * smoothstep(0.75, 0.95, wr) * plains
    # micro-crater saturation: shallow pits too small to stamp one by one
    m1, _, pid = voronoi(warp(nz, P, 6.0, 0.03) * 60.0, 501)
    Hm -= 0.0006 * (1.0 - smoothstep(0.04, 0.12 + 0.25 * pid, m1)) * (pid > 0.45)

    # lobate scarps: long thrust cliffs from global contraction, cutting older craters
    for _ in range(6):
        lobate_scarp(Hm, rng, nz, float(rng.uniform(0.0025, 0.0045)), float(rng.uniform(0.18, 0.45)))

    # epoch 2: young craters on top of everything, a few with bright rays
    fresh_alb = np.zeros_like(Hm)
    young = crater_set(rng, 420, 0.005, 0.02, 2.3)
    for c, r in young:
        idx, x, az, Ps = stamp_crater(Hm, c, r, depth=r * 0.27, rim=r * 0.08, noise=nz, ext=2.4)
        fresh_alb[idx] = np.maximum(fresh_alb[idx], 0.5 * np.exp(-np.maximum(x - 0.7, 0) * 2.2))
    # (centre, crater radius, stamp extent in radii, ray reach rad, ray count, ray bundles):
    # three Hokusai-like systems whose few long, uneven sprays cross most of a
    # hemisphere, four lesser ones
    fresh = [((58, 17), 0.045, 15.0, 1.5, 38, 5), ((-11, 31), 0.024, 10.0, 0.6, 30, 0),
             ((-34, 12), 0.035, 12.0, 1.3, 32, 4), ((3, 250), 0.03, 11.0, 1.3, 35, 5),
             ((-55, 300), 0.028, 9.0, 0.7, 34, 0), ((40, 95), 0.02, 8.0, 0.55, 26, 0),
             ((-20, 135), 0.018, 7.0, 0.5, 24, 0)]
    ray_rng = np.random.default_rng(SEED + 3)    # its own stream: the relief stays as it was
    for (la, lo), r, L, reach, n, nb in fresh:
        c = dir_from(la, lo)
        idx, x, az, Ps = stamp_crater(Hm, c, r, depth=r * 0.3, rim=r * 0.1, noise=nz,
                                      floor_frac=0.4, peak=r * 0.1 if r > 0.025 else 0.0, ext=L)
        # a bright, patchy continuous ejecta blanket out to ~3 radii, the rays grow out of it
        halo = np.exp(-np.maximum(x - 1.0, 0) / 1.6) * smoothstep(0.85, 1.0, x) \
            * (0.7 + 0.3 * smoothstep(-0.3, 0.3, fbm(nz, Ps, 1.0 / r, 3)))
        bright = np.maximum(halo, 0.85 * (1 - smoothstep(0.8, 1.0, x)))
        fresh_alb[idx] = np.maximum(fresh_alb[idx], bright)
        ridx, ray = ray_system(c, r, reach, n, ray_rng, nz, bundles=nb)
        fresh_alb[ridx] = np.maximum(fresh_alb[ridx], ray)
    for c, r in young[:30]:          # the largest young craters keep short, often lopsided ray systems
        ridx, ray = ray_system(c, r, r * float(ray_rng.uniform(15, 35)), int(ray_rng.integers(6, 17)), ray_rng, nz,
                               skew=0.7)
        fresh_alb[ridx] = np.maximum(fresh_alb[ridx], float(ray_rng.uniform(0.55, 0.9)) * ray)

    # albedo (sRGB): grey-brown intercrater terrain, warmer brighter plains,
    # darker bluish low-reflectance material, bright fresh ejecta and rays
    base = hexcol("#85827e")
    plain_c = hexcol("#908c86")
    lrm_c = hexcol("#5f6267")
    lrm = smoothstep(0.18, 0.4, fbm(nz, P + 11.0, 1.8, 5)) * (1 - plains)
    var = 1.0 + 0.1 * fbm(nz, P + 3.3, 2.5, 5) + 0.04 * fbm(nz, P, 30.0, 3) + 0.06 * plains * fbm(nz, P + 7.7, 8.0, 4)
    alb = base * (1 - plains[..., None]) + plain_c * plains[..., None]
    alb = alb * (1 - 0.7 * lrm[..., None]) + lrm_c * (0.7 * lrm[..., None])
    alb = alb * var[..., None] * (1.0 + np.clip(wall, -0.1, 0.18))[..., None]
    alb = alb + (hexcol("#e6e3de") - alb) * np.clip(fresh_alb, 0, 1)[..., None]
    return Hm, alb


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opt = dict(a[2:].split("=", 1) for a in argv if a.startswith("--") and "=" in a)
    out = os.path.abspath(opt.get("out", os.path.join(os.path.dirname(__file__), "..", "..", "assets-src")))
    os.makedirs(out, exist_ok=True)
    Hm, alb = mercury()
    srgb, s = calibrate(alb, TARGET_MEDIAN)
    print(f"w-rock: albedo scale {s:.4f}")
    write_png(os.path.join(out, "w-rock.png"), srgb)
    Hm = Hm - float(Hm.mean())
    Hn = Hm.reshape(NH, 2, NW, 2).mean(axis=(1, 3))       # 2x2 box down to the normal map's size
    Hn = soften(Hn, NORMAL_SOFTEN_PX)
    write_png(os.path.join(out, "w-rock_normal.png"), normal_map(Hn, NORMAL_STRENGTH))


main()
