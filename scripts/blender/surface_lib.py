# Shared numpy surface painting for the Blender generators (gen_mars_moons.py;
# formerly gen_moon.py, gen_world_rock.py, gen_world_dwarf.py, whose outputs
# are retired): seeded gradient noise,
# fbm, domain warp, cellular noise, crater profiles and stamping, ray streaks,
# colour helpers, and the new worlds' equirect grid, normal map and writer.
# Pure numpy, no bpy, no grid globals: each generator owns its grid (the
# moon's own, or equirect_grid() for the worlds) and binds a crater stamper to
# it with crater_stamper(). Import it from a generator with
#   sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
#   from surface_lib import ...
# Changing Perlin, fbm, crater_height or smoothstep changes phobos.glb and
# deimos.glb: re-run gen_mars_moons.py and update assets-src/MANIFEST.md.
import math
import struct
import zlib

import numpy as np


# ------------------------------------------------------------------ colour and vectors
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


def crater_stamper(P, window, local_polar):
    """Bind stamp_crater to a generator's grid: P is its (H, W, 3) texel
    directions, window(c, R) its seam-safe texel window and local_polar(Ps, c)
    its angular distance and azimuth around c."""

    def stamp_crater(Hm, c, r, depth, rim, noise, floor_frac=0.0, peak=0.0, erase=0.85,
                     irregular=0.08, ext=2.6, ejecta=4.0, poly=0.0, sides=6, turn=0.0):
        idx = window(c, r * ext)
        Ps = P[idx]
        ang, az = local_polar(Ps, c)
        wob = 1.0 + irregular * noise(Ps * (3.0 / max(r, 0.02)))
        if poly > 0:
            # polygonal outline (large craters on fractured crusts, like Ceres's):
            # the radius of a regular n-gon in direction az, mean ~1
            seg = 2 * np.pi / sides
            ngon = np.cos(np.pi / sides) / np.cos(np.mod(az - turn, seg) - np.pi / sides)
            wob = wob * (1.0 - poly + poly * ngon / (0.5 + 0.5 * np.cos(np.pi / sides)))
        x = ang / (r * wob)
        inside = 1.0 - smoothstep(0.7, 1.08, x)
        taper = 1.0 - smoothstep(0.7, 0.97, ang / (r * ext))     # no step at the window edge
        Hm[idx] = Hm[idx] * (1.0 - erase * inside) + crater_height(x, depth, rim, floor_frac, peak, ejecta) * taper
        return idx, x, az, Ps

    return stamp_crater


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


# ------------------------------------------------------------------ the new worlds' equirect maps
def equirect_grid(W, H):
    """A W x H grid in THREE.SphereGeometry's convention (row 0 is the north
    pole; texel (u, v) has phi = u * 2PI, lat = PI/2 - v * PI and
    x = -cos(phi) cos(lat), y = sin(lat), z = sin(phi) cos(lat)).
    Returns P (H, W, 3) texel directions, window(c, R) and local_polar(Ps, c)."""
    lat = (np.pi / 2 - (np.arange(H) + 0.5) / H * np.pi).astype(np.float32)
    phi = ((np.arange(W) + 0.5) / W * 2 * np.pi).astype(np.float32)
    cl = np.cos(lat)[:, None]
    P = np.stack([-np.cos(phi)[None, :] * cl,
                  np.repeat(np.sin(lat)[:, None], W, 1),
                  np.sin(phi)[None, :] * cl], -1).astype(np.float32)
    rows = np.arange(H)

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
        return np.ix_(rows[r0:r1], cols)

    def local_polar(Ps, c):
        """Angular distance to c and azimuth around c for points Ps."""
        dot = np.clip(Ps @ c, -1, 1)
        ang = np.arccos(dot)
        t1 = np.cross(c, [0.0, 1.0, 0.0] if abs(c[1]) < 0.9 else [1.0, 0.0, 0.0])
        t1 = (t1 / np.linalg.norm(t1)).astype(np.float32)
        t2 = np.cross(c, t1).astype(np.float32)
        az = np.arctan2(Ps @ t2, Ps @ t1)
        return ang, az

    return P, window, local_polar


def dir_from(lat_deg, lon_deg):
    """Unit vector at a latitude and longitude (deg), in equirect_grid's convention."""
    la, lo = math.radians(lat_deg), math.radians(lon_deg)
    return np.array([-math.cos(lo) * math.cos(la), math.sin(la), math.sin(lo) * math.cos(la)], np.float32)


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


def soften_sphere(F, sigma):
    """Gaussian of `sigma` texels of latitude, isotropic on the sphere: each
    row is blurred in longitude by sigma / cos(lat) texels (FFT, wraps), so
    detail near the poles is not smeared north-south into radial spokes
    (soften() blurs in texels, which near a pole is far wider north-south)."""
    h, w = F.shape
    lat = np.pi / 2 - (np.arange(h) + 0.5) / h * np.pi
    s_row = sigma * (w / (2 * h)) / np.maximum(np.cos(lat), 1e-3)     # texels of longitude
    f = np.fft.rfftfreq(w)
    G = np.fft.irfft(np.fft.rfft(F, axis=1) * np.exp(-2 * (np.pi * s_row[:, None] * f[None, :]) ** 2), n=w, axis=1)
    r = int(math.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k = k / k.sum()
    Gp = np.pad(G, ((r, r), (0, 0)), mode="edge")
    return sum(k[i + r] * Gp[r + i:r + i + h] for i in range(-r, r + 1)).astype(np.float32)


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
