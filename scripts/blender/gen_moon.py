# Three cinematic moons in one GLB, painted texel-by-texel in numpy.
#   $BLENDER --background --python scripts/blender/gen_moon.py
#
# Original work: every vertex and texel below is generated procedurally from
# a fixed seed (no Cycles bake, no sampling noise), so a re-run reproduces the
# same geometry, the same PBR factors and the same pixels.
#
# Game contract (OrbitingMoon in SpacePlanets.tsx picks a variant by name):
#   node / mesh      material       look
#   Moon_Rock        MoonRock       grey highlands, dark maria, rayed craters
#   Moon_Ice         MoonIce        bright ice, long double-ridge lineae,
#                                   chaos rafts, faint cyan glowing cracks
#   Moon_Volcanic    MoonVolcanic   dark basalt, calderas with lava lakes,
#                                   orange glowing fissure network
#   - each mesh is centred on its own node origin, mean radius 1.0
#   - UV sphere 64 x 36 -> 4480 triangles each, equirectangular UVs
#   - baseColor + tangent normal maps 1024^2; Ice/Volcanic also emissive
#     1024^2 with emissiveFactor [1,1,1]; metallic 0
#   - base colours stay fairly neutral: the game multiplies them by a tint
#
# Method: each moon is a height field H and colour fields over an
# equirectangular grid. The mesh takes a blurred H (what 4.5k tris can carry);
# the normal map carries the residual H - blur(H), so shading = full detail.
import bpy
import math
import os

import numpy as np

SEED = 20261011
N = 1024                 # texture size (square equirect)
SEG, RINGS = 64, 36      # UV-sphere resolution -> 4480 tris
GEO_SIGMA = 0.030        # rad: detail the mesh carries; the rest -> normal map
SPACING = 2.6            # preview layout along X (each mesh centred on its node)

bpy.ops.wm.read_factory_settings(use_empty=True)

# ------------------------------------------------------------------ grid
_v = (np.arange(N) + 0.5) / N
LAT = (_v * np.pi - np.pi / 2).astype(np.float32)          # rows: v=0 south
LON = (_v * 2 * np.pi - np.pi).astype(np.float32)          # cols: u=0 at -pi
_cl = np.cos(LAT)[:, None]
P = np.stack([_cl * np.cos(LON)[None, :],
              _cl * np.sin(LON)[None, :],
              np.repeat(np.sin(LAT)[:, None], N, 1)], -1).astype(np.float32)
ROWS = np.arange(N)


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


# ------------------------------------------------------------------ noise
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
    """Row index array + column index array of grid texels within ~R rad of c."""
    latc = math.asin(max(-1.0, min(1.0, float(c[2]))))
    lonc = math.atan2(float(c[1]), float(c[0]))
    r0 = max(0, int(math.floor((latc - R + math.pi / 2) / math.pi * N)) - 1)
    r1 = min(N, int(math.ceil((latc + R + math.pi / 2) / math.pi * N)) + 1)
    if abs(latc) + R > 1.45:
        cols = np.arange(N)
    else:
        dl = min(math.pi, R / math.cos(abs(latc) + R))
        j0 = int(math.floor((lonc - dl + math.pi) / (2 * math.pi) * N)) - 1
        j1 = int(math.ceil((lonc + dl + math.pi) / (2 * math.pi) * N)) + 1
        cols = np.arange(j0, j1) % N if j1 - j0 < N else np.arange(N)
    return np.ix_(ROWS[r0:r1], cols)


def local_polar(Ps, c):
    """Angular distance to c and azimuth around c for points Ps."""
    dot = np.clip(Ps @ c, -1, 1)
    ang = np.arccos(dot)
    t1 = np.cross(c, [0.0, 0.0, 1.0] if abs(c[2]) < 0.9 else [1.0, 0.0, 0.0])
    t1 = (t1 / np.linalg.norm(t1)).astype(np.float32)
    t2 = np.cross(c, t1).astype(np.float32)
    az = np.arctan2(Ps @ t2, Ps @ t1)
    return ang, az


def blur_sphere(F, sigma):
    """Gaussian blur of an equirect field with an angular sigma (rad)."""
    k = int(math.ceil(4 * sigma / (math.pi / N)))
    # rows beyond a pole continue on the opposite meridian
    top = np.roll(F[-k:][::-1], N // 2, axis=1)
    bot = np.roll(F[:k][::-1], N // 2, axis=1)
    G = np.concatenate([bot, F, top], 0)
    M = G.shape[0]
    fy = np.fft.rfftfreq(M)
    sv = sigma / (math.pi / N)
    G = np.fft.irfft(np.fft.rfft(G, axis=0) * np.exp(-2 * math.pi ** 2 * sv ** 2 * fy ** 2)[:, None],
                     n=M, axis=0)[k:k + N]
    fx = np.fft.rfftfreq(N)
    sh = sigma / (np.maximum(np.cos(LAT), 0.02) * (2 * math.pi / N))
    sh = np.minimum(sh, N)
    G = np.fft.irfft(np.fft.rfft(G, axis=1) * np.exp(-2 * math.pi ** 2 * (sh[:, None] ** 2) * fx[None, :] ** 2),
                     n=N, axis=1)
    return G.astype(np.float32)


def normal_map(R, strength):
    """Tangent-space (OpenGL, Blender UV) normal map from a residual height."""
    gx = (np.roll(R, -1, 1) - np.roll(R, 1, 1)) / (2 * (2 * math.pi / N) * np.maximum(np.cos(LAT), 0.08)[:, None])
    gy = np.zeros_like(R)
    gy[1:-1] = (R[2:] - R[:-2]) / (2 * math.pi / N)
    # the pole triangle fans have degenerate tangents: fade detail out there
    fade = smoothstep(1.50, 1.36, np.abs(LAT))[:, None]
    nx, ny = -gx * strength * fade, -gy * strength * fade
    nz = np.ones_like(R)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5


# ------------------------------------------------------------------ craters
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


def angdiff(a, b):
    return np.angle(np.exp(1j * (a - b)))


# ------------------------------------------------------------------ moons
def moon_rock():
    rng = np.random.default_rng(SEED + 1)
    nz = Perlin(SEED + 2)
    H = 0.008 * fbm(nz, P, 2.2, 6) + 0.0012 * fbm(nz, P, 22.0, 4)
    wall = np.zeros_like(H)      # albedo: +bright crater walls/rims, -dark floors

    # epoch 1: ancient basins and a saturated crater population
    bdirs = [(0.9, -0.35, 0.25), (-0.2, -0.95, -0.25), (-0.75, 0.45, 0.4), (0.25, 0.7, -0.55)]
    basins = []
    for d in bdirs:
        c = np.array(d, np.float32) + 0.15 * unit(rng)
        basins.append(((c / np.linalg.norm(c)).astype(np.float32), float(rng.uniform(0.34, 0.52))))
    for c, r in basins:
        stamp_crater(H, c, r, depth=0.03, rim=0.007, noise=nz, floor_frac=0.6, erase=0.6,
                     irregular=0.14, ext=1.9, ejecta=2.5)
    for c, r in crater_set(rng, 16, 0.09, 0.28, 1.6):
        idx, x, az, Ps = stamp_crater(H, c, r, depth=r * 0.15, rim=r * 0.05, noise=nz, floor_frac=0.62,
                                      peak=r * 0.06, irregular=0.08)
        wall[idx] += 0.06 * np.exp(-((x - 0.85) / 0.1) ** 2) - 0.04 * (x < 0.75)
    for c, r in crater_set(rng, 95, 0.03, 0.09, 2.2):
        idx, x, az, Ps = stamp_crater(H, c, r, depth=r * 0.22, rim=r * 0.07, noise=nz,
                                      floor_frac=0.3 if r > 0.055 else 0.0)
        wall[idx] += 0.05 * np.exp(-((x - 0.85) / 0.12) ** 2)
    for c, r in crater_set(rng, 600, 0.010, 0.03, 2.4):
        stamp_crater(H, c, r, depth=r * 0.25, rim=r * 0.07, noise=nz, ext=2.2)

    # maria: lava floods the basins and a few irregular lowlands
    mare = np.zeros_like(H)
    edge = 0.30 * fbm(nz, P, 3.2, 5) + 0.12 * fbm(nz, P + 1.7, 9.0, 3)
    for c, r in basins:
        d = np.arccos(np.clip(P @ c, -1, 1)) / r
        mare = np.maximum(mare, 1.0 - smoothstep(0.88, 1.0, d + edge))
    blob = fbm(nz, P + 9.1, 1.5, 5) + 0.6 * edge
    mare = np.maximum(mare, smoothstep(0.15, 0.2, blob))
    H = H * (1.0 - 0.85 * mare) - 0.008 * mare
    wall *= (1 - mare)
    # wrinkle ridges on the mare plains
    wr = fbm(nz, P + 2.2, 7.0, 3, ridged=True)
    H += 0.0012 * smoothstep(0.75, 0.95, wr) * mare
    # micro-crater saturation: shallow pits too small to stamp one by one
    m1, _, pid = voronoi(warp(nz, P, 6.0, 0.03) * 40.0, 501)
    H -= 0.0007 * (1.0 - smoothstep(0.04, 0.12 + 0.25 * pid, m1)) * (pid > 0.45)

    # epoch 2: young craters on top of everything, a few with bright rays
    fresh_alb = np.zeros_like(H)
    for c, r in crater_set(rng, 320, 0.009, 0.035, 2.3):
        idx, x, az, Ps = stamp_crater(H, c, r, depth=r * 0.27, rim=r * 0.08, noise=nz, ext=2.4)
        fresh_alb[idx] = np.maximum(fresh_alb[idx], 0.22 * np.exp(-np.maximum(x - 0.7, 0) * 2.2))
    for c, r in crater_set(rng, 20, 0.035, 0.08, 1.8):
        idx, x, az, Ps = stamp_crater(H, c, r, depth=r * 0.25, rim=r * 0.08, noise=nz, floor_frac=0.3)
        fresh_alb[idx] = np.maximum(fresh_alb[idx], 0.25 * np.exp(-np.maximum(x - 0.7, 0) * 2.5))
    fresh = [((0.55, -0.75, -0.3), 0.075, 14.0), ((-0.35, 0.88, 0.3), 0.05, 11.0),
             ((0.1, -0.8, 0.6), 0.04, 9.0), ((-0.9, -0.35, -0.15), 0.04, 9.0),
             ((0.45, 0.6, 0.6), 0.035, 8.0), ((0.0, 0.2, -0.95), 0.03, 7.0)]
    for k, (c, r, L) in enumerate(fresh):
        c = np.array(c, np.float32)
        c /= np.linalg.norm(c)
        idx, x, az, Ps = stamp_crater(H, c, r, depth=r * 0.3, rim=r * 0.1, noise=nz,
                                      floor_frac=0.4, peak=r * 0.1 if k == 0 else 0.0, ext=L)
        halo = np.exp(-np.maximum(x - 1.0, 0) * 1.5) * smoothstep(0.85, 1.0, x)
        bright = np.maximum(0.85 * halo, np.clip(1.25 * rays(nz, x, az, L, k), 0, 1))
        bright = np.maximum(bright, 0.5 * (1 - smoothstep(0.8, 1.0, x)))
        fresh_alb[idx] = np.maximum(fresh_alb[idx], bright)

    # albedo (sRGB): neutral highlands, dark maria, bright fresh ejecta
    high = np.array([0.60, 0.595, 0.58], np.float32)
    mar = np.array([0.27, 0.275, 0.29], np.float32)
    mvar = 0.06 * fbm(nz, P + 5.0, 4.0, 4)
    var = 1.0 + 0.12 * fbm(nz, P + 3.3, 2.5, 5) + 0.04 * fbm(nz, P, 30.0, 3)
    alb = (high * (1 - mare[..., None]) + (mar + mvar[..., None]) * mare[..., None]) * var[..., None]
    alb = alb * (1.0 + np.clip(wall, -0.1, 0.18))[..., None]
    alb = alb + (np.array([0.95, 0.95, 0.94], np.float32) - alb) * np.clip(fresh_alb, 0, 1)[..., None]
    return H, alb, None, 5.5


def moon_ice():
    rng = np.random.default_rng(SEED + 11)
    nz = Perlin(SEED + 12)
    H = 0.0025 * fbm(nz, P, 2.5, 4) + 0.0003 * fbm(nz, P, 30.0, 3, ridged=True)
    base = np.array([0.89, 0.92, 0.95], np.float32)
    alb = base * (1.0 + 0.04 * fbm(nz, P + 2.0, 3.0, 5))[..., None]
    tone = smoothstep(0.0, 0.45, fbm(nz, P + 8.0, 1.2, 4))[..., None]
    alb = alb * (1 - 0.5 * tone) + np.array([0.84, 0.82, 0.79], np.float32) * (0.5 * tone)
    band = np.array([0.68, 0.57, 0.49], np.float32)   # desaturated tan lineae
    glow = np.zeros(P.shape[:-1], np.float32)

    Q = warp(nz, P, 1.4, 0.12)          # cycloidal wander of the lineae
    mott = (0.86 + 0.28 * np.clip(fbm(nz, P + 6.6, 9.0, 4) + 0.5, 0, 1))[..., None]

    # chaos terrain: broken ice rafts in a darker hummocky matrix
    for k in range(3):
        c = unit(rng)
        r = float(rng.uniform(0.20, 0.32))
        idx = window(c, r * 1.5)
        Ps = P[idx]
        d = np.arccos(np.clip(Ps @ c, -1, 1)) / r + 0.4 * fbm(nz, Ps, 4.0, 4)
        m = 1.0 - smoothstep(0.85, 1.0, d)
        F1, F2, cid = voronoi(Ps * 17.0, 77 + k)
        gap = 1.0 - smoothstep(0.06, 0.22, F2 - F1)
        rafts = smoothstep(0.35, 0.5, cid)          # some cells survive as rafts
        lump = fbm(nz, Ps, 45.0, 3)
        raft_h = 0.004 * rafts * (1 - gap) + 0.0012 * lump * (1 - rafts) - 0.002
        H[idx] = H[idx] * (1 - m) + raft_h * m
        matrix = band * (0.92 + 0.12 * lump[..., None])
        tgt = base * (0.94 + 0.06 * cid[..., None])
        sel = (rafts * (1 - gap))[..., None]
        tgt = tgt * sel + matrix * (1 - sel)
        alb[idx] = alb[idx] * (1 - m[..., None]) + tgt * m[..., None]
        glow[idx] = np.maximum(glow[idx], 0.25 * gap * rafts * m)

    # lineae: old to young; each cuts through what came before
    specs = []
    for k in range(5):
        specs.append(("band", float(rng.uniform(0.025, 0.045)), float(rng.uniform(1.2, 3.2))))
    for k in range(13):
        specs.append(("ridge", float(rng.uniform(0.020, 0.030)), float(rng.uniform(0.8, 2 * math.pi))))
    for k in range(22):
        specs.append(("crack", float(rng.uniform(0.007, 0.010)), float(rng.uniform(0.4, 2.0))))
    order = rng.permutation(len(specs))
    young = set(int(i) for i in order[-14:])
    for k in order:
        kind, w, length = specs[int(k)]
        nrm = unit(rng)
        a = np.cross(nrm, unit(rng))
        a = (a / np.linalg.norm(a)).astype(np.float32)
        b = np.cross(nrm, a).astype(np.float32)
        th0 = float(rng.uniform(-math.pi, math.pi))
        s = np.arcsin(np.clip(Q @ nrm, -1, 1))
        th = np.arctan2(Q @ b, Q @ a)
        dth = np.mod(th - th0, 2 * math.pi)
        if length >= 2 * math.pi - 1e-3:
            along = np.ones_like(s)
        else:
            along = smoothstep(0.0, 0.3, dth) * (1 - smoothstep(length - 0.4, length, dth)) * (dth < length)
        along = along * (0.75 + 0.25 * np.clip(fbm(nz, P + float(k), 6.0, 2) + 0.6, 0, 1))
        sw = s / w
        if kind == "band":
            prof = -0.0010 * np.exp(-sw ** 4) + 0.0006 * np.exp(-((np.abs(sw) - 1.0) / 0.12) ** 2)
            m = (1.0 - smoothstep(0.9, 1.3, np.abs(sw))) * along
            H = H * (1 - 0.8 * m) + prof * along
            stripes = 0.85 + 0.15 * np.cos(sw * 9.0 + 1.3)
            dm = (1.0 - smoothstep(0.75, 1.05, np.abs(sw))) * along * 0.85
            alb = alb * (1 - dm[..., None]) + (band * mott * stripes[..., None]) * dm[..., None]
        elif kind == "ridge":
            prof = 0.0016 * (np.exp(-((np.abs(sw) - 0.45) / 0.3) ** 2) - 0.6 * np.exp(-(sw / 0.22) ** 2))
            m = (1.0 - smoothstep(1.0, 1.6, np.abs(sw))) * along
            H = H * (1 - 0.8 * m) + prof * along
            dm = np.exp(-(sw / 1.5) ** 2) * along * 0.6
            alb = alb * (1 - dm[..., None]) + band * mott * dm[..., None]
            ridge = np.exp(-((np.abs(sw) - 0.45) / 0.25) ** 2) * along
            alb = alb + (np.array([0.93, 0.93, 0.93], np.float32) - alb) * (0.35 * ridge)[..., None]
        else:
            prof = -0.0009 * np.exp(-(sw / 0.6) ** 2)
            H = H + prof * along
            dm = np.exp(-(sw / 0.9) ** 2) * along * 0.4
            alb = alb * (1 - dm[..., None]) + band * dm[..., None]
        if int(k) in young:
            core = np.exp(-(s / max(0.25 * w, 0.0045)) ** 2) * along
            flick = 0.5 + 0.5 * np.clip(fbm(nz, P + float(k) * 3.1, 8.0, 3) * 2 + 0.5, 0, 1)
            glow = np.maximum(glow, core * flick * (0.7 if kind == "band" else 1.0))

    # a few fresh impacts with blue-white ejecta
    for k, (c, r) in enumerate(crater_set(rng, 10, 0.014, 0.055, 1.7)):
        idx, x, az, Ps = stamp_crater(H, c, r, depth=r * 0.16, rim=r * 0.05, noise=nz,
                                      floor_frac=0.35, peak=r * 0.05, ext=5.0)
        halo = np.exp(-np.maximum(x - 1.0, 0) * 1.3) * smoothstep(0.9, 1.05, x)
        br = np.maximum(halo, 0.8 * rays(nz, x, az, 5.0, k + 40))
        br = np.maximum(br, 0.6 * (1 - smoothstep(0.8, 1.0, x)))
        alb[idx] = alb[idx] + (np.array([0.95, 0.985, 1.0], np.float32) - alb[idx]) * br[..., None]

    em = srgb_to_lin(hexcol("#7fe8ff"))[None, None, :] * (0.32 * np.clip(glow, 0, 1))[..., None]
    return H, alb, em, 3.8


def moon_volcanic():
    rng = np.random.default_rng(SEED + 21)
    nz = Perlin(SEED + 22)
    H = 0.012 * fbm(nz, P, 2.0, 6) + 0.0025 * fbm(nz, P, 12.0, 5, ridged=True)
    mass = smoothstep(0.22, 0.42, fbm(nz, P + 7.7, 1.7, 4))
    H += 0.024 * mass * fbm(nz, P, 5.0, 5, ridged=True)

    basalt = np.array([0.25, 0.24, 0.23], np.float32)
    ash = np.array([0.46, 0.43, 0.36], np.float32)
    rust = np.array([0.50, 0.37, 0.30], np.float32)
    a = smoothstep(0.08, 0.32, fbm(nz, P + 4.4, 2.4, 5))
    alb = basalt * (1 - a[..., None]) + ash * a[..., None]
    alb = alb * (1.0 + 0.10 * fbm(nz, P, 9.0, 4))[..., None]
    alb = alb * (1.0 + 0.25 * mass * fbm(nz, P, 5.0, 5, ridged=True))[..., None]
    heat = np.zeros(P.shape[:-1], np.float32)       # 0..1 lava intensity
    hot = np.zeros(P.shape[:-1], np.float32)        # 0..1 yellow-hot core

    # rifts: long warped cellular edges, broken into segments, dense in rift zones
    Q = warp(nz, P, 2.0, 0.18)
    gate = smoothstep(-0.12, 0.18, fbm(nz, P + 1.9, 1.4, 4))
    F1, F2, _ = voronoi(Q * 2.6, 101)
    e = F2 - F1
    seg = smoothstep(-0.1, 0.15, fbm(nz, Q, 5.0, 3))                   # breaks along the rifts
    wid = 0.028 * (0.35 + 1.0 * np.clip(fbm(nz, P + 0.7, 3.5, 3) + 0.5, 0, 1.2))
    rift = np.exp(-(e / wid) ** 2) * gate * seg
    near = np.exp(-(e / 0.16) ** 2) * gate                              # zone around rifts
    F1b, F2b, _ = voronoi(Q * 7.5 + 3.0, 211)
    eb = F2b - F1b
    crack = np.exp(-(eb / 0.05) ** 2) * near * smoothstep(-0.2, 0.2, fbm(nz, Q + 4.0, 9.0, 2))
    lines = np.maximum(rift, 0.6 * crack)
    halo = np.maximum(np.exp(-(e / (wid * 3.2)) ** 2) * gate * seg, 0.45 * np.exp(-(eb / 0.15) ** 2) * near)
    heat = np.maximum(heat, lines)
    hot = np.maximum(hot, np.exp(-(e / (wid * 0.4)) ** 2) * gate * seg * smoothstep(0.022, 0.034, wid))
    H -= 0.0035 * lines
    H += 0.0014 * np.exp(-((e - wid * 1.7) / wid) ** 2) * gate * seg   # chilled lips
    alb = alb * (1.0 - 0.55 * np.clip(halo, 0, 1)[..., None])

    # calderas (paterae): steep-walled pits, most holding crusted lava lakes
    for k in range(12):
        c = unit(rng)
        r = float(rng.uniform(0.045, 0.12)) if k > 2 else float(rng.uniform(0.13, 0.18))
        lake = k % 3 != 2
        idx = window(c, r * 6.0)
        Ps = P[idx]
        ang, az = local_polar(Ps, c)
        x = ang / (r * (1.0 + 0.2 * nz(Ps * (2.5 / r))))
        taper = 1.0 - smoothstep(0.7, 0.97, ang / (r * 6.0))
        inside = 1 - smoothstep(0.86, 1.0, x)
        floor = -0.02 * min(1.0, r / 0.1)
        h = floor * inside + 0.003 * np.exp(-np.maximum(x - 1, 0) * 4) * smoothstep(0.9, 1.0, x)
        H[idx] = H[idx] * (1 - 0.9 * inside) + h
        # dark lava flows lobing out of the rim; pale plume ring further out
        flow = smoothstep(0.05, 0.2, fbm(nz, Ps + k, 1.8 / r, 3) + 0.55 * (1 - x / 3.0)) * smoothstep(0.92, 1.0, x) * (1 - smoothstep(2.8, 3.4, x))
        ring = np.exp(-((x - 4.2) / 1.0) ** 2) * (0.35 + 0.65 * np.clip(nz(Ps * 9 + k) + 0.6, 0, 1)) * (k % 2 == 0) * taper
        sub = alb[idx]
        sub = sub + (rust - sub) * (0.65 * ring)[..., None]
        sub = sub * (1 - 0.6 * flow[..., None])
        sub = sub * (1 - inside[..., None]) + np.array([0.08, 0.075, 0.07], np.float32) * inside[..., None]
        alb[idx] = sub
        shore = np.exp(-((x - 0.84) / 0.06) ** 2)
        if lake:
            Wc = warp(nz, Ps, 3.0 / r, 0.25 * r)
            Fc1, Fc2, cid = voronoi(Wc * (5.5 / r), 300 + k)
            cr = np.exp(-((Fc2 - Fc1) / 0.06) ** 2)
            lav = inside * (0.18 * cid + cr) * (1 - smoothstep(0.72, 0.86, x)) + shore
            heat[idx] = np.maximum(heat[idx], np.clip(lav, 0, 1))
            hot[idx] = np.maximum(hot[idx], 0.9 * shore + 0.5 * cr * inside * (x < 0.5))
            # a glowing overflow channel snaking downhill
            a0 = float(rng.uniform(-math.pi, math.pi))
            wig = 0.35 * nz(np.stack([x * 0.8, np.full_like(x, k * 3.3), np.zeros_like(x)], -1).astype(np.float32))
            lat_d = np.abs(np.sin(angdiff(az, a0 + wig))) * x * r
            Lc = float(rng.uniform(2.5, 4.5))
            chan = np.exp(-(lat_d / 0.005) ** 2) * (np.cos(angdiff(az, a0)) > 0) * smoothstep(0.85, 1.0, x) \
                * (1 - smoothstep(Lc * 0.6, Lc, x))
            heat[idx] = np.maximum(heat[idx], 0.85 * chan)
            alb[idx] = alb[idx] * (1 - 0.6 * np.exp(-(lat_d / 0.016) ** 2) * (np.cos(angdiff(az, a0)) > 0)
                                   * (x > 0.9) * (1 - smoothstep(Lc * 0.7, Lc * 1.2, x)))[..., None]
        else:
            heat[idx] = np.maximum(heat[idx], 0.5 * shore)

    orange = srgb_to_lin(hexcol("#ff7a2a"))
    yellow = srgb_to_lin(hexcol("#ffc46a"))
    glowpad = 0.10 * np.clip(halo - lines, 0, 1)
    em = orange[None, None, :] * (np.clip(heat, 0, 1) + glowpad)[..., None]
    em = em + (yellow - orange)[None, None, :] * (0.7 * np.clip(hot, 0, 1))[..., None]
    alb = alb * (1 - 0.75 * np.clip(heat, 0, 1)[..., None])
    return H, alb, em, 6.0


# ------------------------------------------------------------------ assets
def make_image(name, rgb, non_color=False):
    img = bpy.data.images.new(name, width=N, height=N, alpha=False)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    rgba = np.ones((N, N, 4), np.float32)
    rgba[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def bilinear(F, u, v):
    x = u * N - 0.5
    y = np.clip(v * N - 0.5, 0, N - 1.001)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    tx, ty = x - x0, y - y0
    x0m, x1m = x0 % N, (x0 + 1) % N
    y1 = np.minimum(y0 + 1, N - 1)
    return (F[y0, x0m] * (1 - tx) * (1 - ty) + F[y0, x1m] * tx * (1 - ty)
            + F[y1, x0m] * (1 - tx) * ty + F[y1, x1m] * tx * ty)


def finish(name, matname, H, alb, em, nstrength, xoff, roughness):
    H = H - float(H.mean())
    Hgeo = blur_sphere(H, GEO_SIGMA)
    nm = normal_map(H - Hgeo, nstrength)

    # ---- mesh (UV sphere, equirect UVs; seam column duplicated via UVs only)
    verts = [(0.0, 0.0, -1.0)]
    for i in range(1, RINGS):
        la = -math.pi / 2 + math.pi * i / RINGS
        for j in range(SEG):
            lo = -math.pi + 2 * math.pi * j / SEG
            verts.append((math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)))
    verts.append((0.0, 0.0, 1.0))
    V = np.array(verts, np.float64)
    vlat = np.arcsin(np.clip(V[:, 2], -1, 1))
    vlon = np.arctan2(V[:, 1], V[:, 0])
    rad = 1.0 + bilinear(Hgeo, (vlon + math.pi) / (2 * math.pi), (vlat + math.pi / 2) / math.pi)
    rad[0] = 1.0 + float(Hgeo[:2].mean())
    rad[-1] = 1.0 + float(Hgeo[-2:].mean())
    V = V * rad[:, None]
    topi = len(verts) - 1

    def ring(i, j):
        return 1 + (i - 1) * SEG + (j % SEG)

    faces, fuv = [], []
    for j in range(SEG):
        faces.append((0, ring(1, j + 1), ring(1, j)))
        fuv.append([((j + 0.5) / SEG, 0.0), ((j + 1) / SEG, 1 / RINGS), (j / SEG, 1 / RINGS)])
    for i in range(1, RINGS - 1):
        v0, v1 = i / RINGS, (i + 1) / RINGS
        for j in range(SEG):
            faces.append((ring(i, j), ring(i, j + 1), ring(i + 1, j + 1), ring(i + 1, j)))
            fuv.append([(j / SEG, v0), ((j + 1) / SEG, v0), ((j + 1) / SEG, v1), (j / SEG, v1)])
    vt = (RINGS - 1) / RINGS
    for j in range(SEG):
        faces.append((ring(RINGS - 1, j), ring(RINGS - 1, j + 1), topi))
        fuv.append([(j / SEG, vt), ((j + 1) / SEG, vt), ((j + 0.5) / SEG, 1.0)])

    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in V], [], faces)
    uvl = me.uv_layers.new(name="UVMap")
    for poly, uvs in zip(me.polygons, fuv):
        for li, uv in zip(poly.loop_indices, uvs):
            uvl.data[li].uv = uv
    for poly in me.polygons:
        poly.use_smooth = True
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = (xoff, 0.0, 0.0)

    # ---- material
    mat = bpy.data.materials.new(matname)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = roughness
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = make_image(matname + "_color", alb)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    ntex = nt.nodes.new("ShaderNodeTexImage")
    ntex.image = make_image(matname + "_normal", nm, non_color=True)
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    if em is not None:
        etex = nt.nodes.new("ShaderNodeTexImage")
        etex.image = make_image(matname + "_emissive", lin_to_srgb(em))
        nt.links.new(etex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0
    me.materials.append(mat)
    r = np.linalg.norm(V, axis=1)
    print(f"{name}: tris={sum(len(f) - 2 for f in faces)} r[min/mean/max]={r.min():.3f}/{r.mean():.3f}/{r.max():.3f}")
    return ob


for i, (name, matname, fn, rough) in enumerate([
        ("Moon_Rock", "MoonRock", moon_rock, 0.92),
        ("Moon_Ice", "MoonIce", moon_ice, 0.55),
        ("Moon_Volcanic", "MoonVolcanic", moon_volcanic, 0.85)]):
    H, alb, em, ns = fn()
    finish(name, matname, H, alb, em, ns, (i - 1) * SPACING, rough)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "moon.glb"))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)
print("wrote", out)
