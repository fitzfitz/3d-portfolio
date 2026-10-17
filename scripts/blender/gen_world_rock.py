# The airless rock (Mercury-type) world maps, painted texel-by-texel in numpy.
#   $BLENDER --background --python scripts/blender/gen_world_rock.py [-- --out=DIR]
#
# Original work: every texel is generated procedurally from a fixed seed (no
# Cycles bake, no sampling noise), so a re-run reproduces the same pixels.
# Runs in Blender's Python for its bundled numpy, like gen_moon.py, whose
# crater, ray and maria code it ports (here on a 2:1 grid). It uses no bpy.
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
import struct
import sys
import zlib

import numpy as np

SEED = 20261017
W, H = 2048, 1024
NW, NH = 1024, 512          # normal map size
TARGET_MEDIAN = 0.025       # linear luminance (tests/worldMaps.test.ts)
NORMAL_STRENGTH = 3.0       # relief exaggeration in the normal map
NORMAL_SOFTEN_PX = 1.2      # pre-blur of the normal map's height, texels

# ------------------------------------------------------------------ grid
LAT = (np.pi / 2 - (np.arange(H) + 0.5) / H * np.pi).astype(np.float32)
PHI = ((np.arange(W) + 0.5) / W * 2 * np.pi).astype(np.float32)
_cl = np.cos(LAT)[:, None]
P = np.stack([-np.cos(PHI)[None, :] * _cl,
              np.repeat(np.sin(LAT)[:, None], W, 1),
              np.sin(PHI)[None, :] * _cl], -1).astype(np.float32)
ROWS = np.arange(H)


def dir_from(lat_deg, lon_deg):
    la, lo = math.radians(lat_deg), math.radians(lon_deg)
    return np.array([-math.cos(lo) * math.cos(la), math.sin(la), math.sin(lo) * math.cos(la)], np.float32)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def srgb_to_lin(c):
    c = np.asarray(c, np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def hexcol(h):
    return np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)


def unit(rng):
    v = rng.normal(size=3)
    return (v / np.linalg.norm(v)).astype(np.float32)


# ------------------------------------------------------------------ noise (gen_moon.py)
class Perlin:
    """Seeded 3D gradient noise, vectorised over (..., 3) arrays."""

    def __init__(self, seed):
        rng = np.random.default_rng(seed)
        self.perm = np.concatenate([rng.permutation(256)] * 2).astype(np.int32)
        g = rng.normal(size=(256, 3))
        g /= np.linalg.norm(g, axis=1, keepdims=True)
        self.g = g.astype(np.float32)

    def __call__(self, p):
        x, y, z = p[..., 0], p[..., 1], p[..., 2]
        xf, yf, zf = np.floor(x), np.floor(y), np.floor(z)
        fx, fy, fz = x - xf, y - yf, z - zf
        X = xf.astype(np.int32) & 255
        Y = yf.astype(np.int32) & 255
        Z = zf.astype(np.int32) & 255
        pm, g = self.perm, self.g

        def corner(dx, dy, dz):
            h = pm[pm[pm[X + dx] + Y + dy] + Z + dz]
            gg = g[h]
            return gg[..., 0] * (fx - dx) + gg[..., 1] * (fy - dy) + gg[..., 2] * (fz - dz)

        u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
        v = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
        w = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
        x00 = corner(0, 0, 0) + u * (corner(1, 0, 0) - corner(0, 0, 0))
        x10 = corner(0, 1, 0) + u * (corner(1, 1, 0) - corner(0, 1, 0))
        x01 = corner(0, 0, 1) + u * (corner(1, 0, 1) - corner(0, 0, 1))
        x11 = corner(0, 1, 1) + u * (corner(1, 1, 1) - corner(0, 1, 1))
        y0 = x00 + v * (x10 - x00)
        y1 = x01 + v * (x11 - x01)
        return (y0 + w * (y1 - y0)).astype(np.float32)


def fbm(noise, p, freq, octaves, gain=0.5, lac=2.03, ridged=False):
    tot = np.zeros(p.shape[:-1], np.float32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        n = noise(p * freq + np.float32(o * 17.31))
        if ridged:
            n = 1.0 - np.abs(n) * 1.6
        tot += amp * n
        norm += amp
        amp *= gain
        freq *= lac
    return tot / norm


def warp(noise, p, freq, amt):
    """Domain-warp points on the sphere and re-project to the unit sphere."""
    d = np.stack([fbm(noise, p + np.float32(k * 5.7), freq, 3) for k in range(3)], -1)
    q = p + amt * d
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


def _hash01(ix, iy, iz, salt):
    n = (ix.astype(np.uint64) * np.uint64(73856093)) ^ (iy.astype(np.uint64) * np.uint64(19349663)) \
        ^ (iz.astype(np.uint64) * np.uint64(83492791)) ^ np.uint64(salt)
    n = (n ^ (n >> np.uint64(13))) * np.uint64(1274126177)
    n = n ^ (n >> np.uint64(16))
    return ((n & np.uint64(0xFFFFFF)).astype(np.float32)) / np.float32(0x1000000)


def voronoi(p, seed, jitter=0.85):
    """F1, F2 and a per-cell random id for 3D cellular noise."""
    c = np.floor(p)
    f = p - c
    ci = c.astype(np.int64) + 4096
    F1 = np.full(p.shape[:-1], 9.0, np.float32)
    F2 = np.full(p.shape[:-1], 9.0, np.float32)
    cid = np.zeros(p.shape[:-1], np.float32)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                ix, iy, iz = ci[..., 0] + dx, ci[..., 1] + dy, ci[..., 2] + dz
                ox = dx + 0.5 + jitter * (_hash01(ix, iy, iz, seed) - 0.5) - f[..., 0]
                oy = dy + 0.5 + jitter * (_hash01(ix, iy, iz, seed + 1) - 0.5) - f[..., 1]
                oz = dz + 0.5 + jitter * (_hash01(ix, iy, iz, seed + 2) - 0.5) - f[..., 2]
                d = np.sqrt(ox * ox + oy * oy + oz * oz)
                closer = d < F1
                F2 = np.where(closer, F1, np.minimum(F2, d))
                cid = np.where(closer, _hash01(ix, iy, iz, seed + 3), cid)
                F1 = np.where(closer, d, F1)
    return F1, F2, cid


# ------------------------------------------------------------- sphere ops
def window(c, R):
    """Row and column index arrays of grid texels within ~R rad of c (seam-safe)."""
    latc = math.asin(max(-1.0, min(1.0, float(c[1]))))
    phic = math.atan2(float(c[2]), -float(c[0])) % (2 * math.pi)
    r0 = max(0, int(math.floor((math.pi / 2 - latc - R) / math.pi * H)) - 1)
    r1 = min(H, int(math.ceil((math.pi / 2 - latc + R) / math.pi * H)) + 1)
    if abs(latc) + R > 1.45:
        cols = np.arange(W)
    else:
        dl = min(math.pi, R / math.cos(abs(latc) + R))
        j0 = int(math.floor((phic - dl) / (2 * math.pi) * W)) - 1
        j1 = int(math.ceil((phic + dl) / (2 * math.pi) * W)) + 1
        cols = np.arange(j0, j1) % W if j1 - j0 < W else np.arange(W)
    return np.ix_(ROWS[r0:r1], cols)


def local_polar(Ps, c):
    """Angular distance to c and azimuth around c for points Ps."""
    dot = np.clip(Ps @ c, -1, 1)
    ang = np.arccos(dot)
    t1 = np.cross(c, [0.0, 1.0, 0.0] if abs(c[1]) < 0.9 else [1.0, 0.0, 0.0])
    t1 = (t1 / np.linalg.norm(t1)).astype(np.float32)
    t2 = np.cross(c, t1).astype(np.float32)
    az = np.arctan2(Ps @ t2, Ps @ t1)
    return ang, az


def normal_map(R, strength):
    """Tangent-space (OpenGL: +X east along u, +Y north) normal map from a height field."""
    h, w = R.shape
    lat = (np.pi / 2 - (np.arange(h) + 0.5) / h * np.pi).astype(np.float32)
    step = 2 * math.pi / w
    gx = (np.roll(R, -1, 1) - np.roll(R, 1, 1)) / (2 * step * np.maximum(np.cos(lat), 0.08)[:, None])
    gy = np.zeros_like(R)
    gy[1:-1] = (R[:-2] - R[2:]) / (2 * step)          # row j-1 is north of row j
    # the pole triangle fans have degenerate tangents: fade detail out there
    fade = smoothstep(1.50, 1.36, np.abs(lat))[:, None]
    nx, ny = -gx * strength * fade, -gy * strength * fade
    nz = np.ones_like(R)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5


# ------------------------------------------------------------------ craters (gen_moon.py)
def crater_height(x, depth, rim, floor_frac=0.0, peak=0.0, ejecta=4.0):
    x2 = x * x
    inner = depth * (x2 * (0.45 + 0.55 * x2) - 1.0) + rim     # steep upper walls
    if floor_frac > 0:
        fl = -depth * floor_frac + rim
        k = depth * 0.06
        inner = 0.5 * (inner + fl + np.sqrt((inner - fl) ** 2 + k * k))
    outer = rim * np.exp(-(x - 1.0) * ejecta)
    h = np.where(x < 1.0, inner, outer)
    if peak > 0:
        h = h + peak * np.exp(-(x / 0.16) ** 2)
    return h


def stamp_crater(Hm, c, r, depth, rim, noise, floor_frac=0.0, peak=0.0, erase=0.85,
                 irregular=0.08, ext=2.6, ejecta=4.0):
    idx = window(c, r * ext)
    Ps = P[idx]
    ang, az = local_polar(Ps, c)
    wob = 1.0 + irregular * noise(Ps * (3.0 / max(r, 0.02)))
    x = ang / (r * wob)
    inside = 1.0 - smoothstep(0.7, 1.08, x)
    taper = 1.0 - smoothstep(0.7, 0.97, ang / (r * ext))     # no step at the window edge
    Hm[idx] = Hm[idx] * (1.0 - erase * inside) + crater_height(x, depth, rim, floor_frac, peak, ejecta) * taper
    return idx, x, az, Ps


def crater_set(rng, n, rmin, rmax, alpha=2.0):
    """n craters with a power-law size distribution, largest (oldest) first."""
    u = rng.uniform(size=n)
    a = rmin ** (-alpha + 1)
    b = rmax ** (-alpha + 1)
    r = (a + u * (b - a)) ** (1.0 / (-alpha + 1))
    out = [(unit(rng), float(ri)) for ri in r]
    out.sort(key=lambda t: -t[1])
    return out


def rays(noise, x, az, length, k):
    """Bright radial ray streaks around a fresh crater (x in crater radii)."""
    q = np.stack([np.cos(az) * 4.5, np.sin(az) * 4.5, k * 13.7 + x * 0.05], -1).astype(np.float32)
    s = np.clip(noise(q) * 2.0 + 0.1, 0, 1) ** 2.0
    q2 = np.stack([np.cos(az) * 15.0, np.sin(az) * 15.0, k * 7.1 + x * 0.15], -1).astype(np.float32)
    s = s * (0.45 + 0.55 * np.clip(noise(q2) * 2 + 0.5, 0, 1))
    fall = smoothstep(1.0, 1.3, x) * (1.0 - smoothstep(1.2, length, x))
    return s * fall


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
    for c, r in crater_set(rng, 420, 0.005, 0.02, 2.3):
        idx, x, az, Ps = stamp_crater(Hm, c, r, depth=r * 0.27, rim=r * 0.08, noise=nz, ext=2.4)
        fresh_alb[idx] = np.maximum(fresh_alb[idx], 0.3 * np.exp(-np.maximum(x - 0.7, 0) * 2.2))
    fresh = [((58, 17), 0.045, 15.0), ((-11, 31), 0.024, 10.0), ((-34, 12), 0.035, 12.0),
             ((3, 250), 0.03, 11.0), ((-55, 300), 0.028, 9.0), ((40, 95), 0.02, 8.0), ((-20, 135), 0.018, 7.0)]
    for k, ((la, lo), r, L) in enumerate(fresh):
        c = dir_from(la, lo)
        idx, x, az, Ps = stamp_crater(Hm, c, r, depth=r * 0.3, rim=r * 0.1, noise=nz,
                                      floor_frac=0.4, peak=r * 0.1 if r > 0.025 else 0.0, ext=L)
        halo = np.exp(-np.maximum(x - 1.0, 0) * 1.5) * smoothstep(0.85, 1.0, x)
        bright = np.maximum(0.8 * halo, np.clip((1.4 if k == 0 else 1.1) * rays(nz, x, az, L, k), 0, 1))
        bright = np.maximum(bright, 0.5 * (1 - smoothstep(0.8, 1.0, x)))
        fresh_alb[idx] = np.maximum(fresh_alb[idx], bright)

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
    alb = alb + (hexcol("#d6d2cb") - alb) * np.clip(fresh_alb, 0, 1)[..., None]
    return Hm, alb


def calibrate(alb, target):
    """Scale in linear light so the linear-luminance texel median is `target`; returns sRGB."""
    lin = srgb_to_lin(np.clip(alb, 0, 1))
    lum = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    s = target / float(np.sort(lum.ravel())[lum.size // 2])
    return lin_to_srgb(lin * s), s


def soften(F, sigma):
    """Small separable Gaussian (texels; wraps in longitude): drops sub-texel relief
    that would only alias and that WebP cannot carry inside the byte cap."""
    r = int(math.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k = (k / k.sum()).astype(np.float32)
    G = sum(k[i + r] * np.roll(F, i, 1) for i in range(-r, r + 1))
    Gp = np.pad(G, ((r, r), (0, 0)), mode="edge")
    return sum(k[i + r] * Gp[r + i:r + i + F.shape[0]] for i in range(-r, r + 1)).astype(np.float32)


def write_png(path, rgb01):
    """Minimal deterministic PNG writer (8-bit RGB)."""
    a = np.round(np.clip(rgb01, 0, 1) * 255).astype(np.uint8)
    h, w, _ = a.shape
    raw = b"".join(b"\x00" + a[y].tobytes() for y in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) \
        + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path)


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
