// GPU memory ledger: counts the bytes of every texture, renderbuffer and
// buffer the page asks WebGL for, by wrapping the allocation calls on the
// WebGL2 prototype. It sits under three.js and postprocessing, so a render
// target or a texture built behind the scene graph's back is counted too.
//
// Install with page.evaluateOnNewDocument(installGpuLedger) BEFORE navigation,
// read with readGpuLedger(page). Used by tests/e2e/memory.probe.mjs (the
// budget) and scripts/perf/memory-footprint.mjs (next to the real footprint).
//
// What it can and cannot see:
// - Sizes are what WebGL was asked for: width × height × bytes per texel, per
//   mip level and face. RGB8 counts as 4 bytes, as drivers pad it.
// - The canvas's own buffers are not WebGL calls: `drawingBuffer` estimates
//   them from the context attributes (colour + depth/stencil, ×4 samples when
//   antialias is on, plus the resolve buffer). The browser's compositor copies
//   of the canvas are not counted at all.
// - Driver overhead, shader programs and alignment are not counted, so the
//   GPU process's real footprint is always higher than this total.

/** Page-side. Self-contained: puppeteer serialises it, so it may not close over anything. */
export function installGpuLedger() {
  if (window.__gpuLedger || typeof WebGL2RenderingContext === "undefined") return;
  const GL = WebGL2RenderingContext;

  // Bytes per texel for sized internal formats.
  const SIZED = {
    [GL.R8]: 1, [GL.R8_SNORM]: 1, [GL.R8UI]: 1, [GL.R8I]: 1, [GL.STENCIL_INDEX8]: 1,
    [GL.RG8]: 2, [GL.RG8_SNORM]: 2, [GL.RG8UI]: 2, [GL.RG8I]: 2, [GL.R16F]: 2, [GL.R16UI]: 2, [GL.R16I]: 2,
    [GL.RGBA4]: 2, [GL.RGB565]: 2, [GL.RGB5_A1]: 2, [GL.DEPTH_COMPONENT16]: 2,
    [GL.RGB8]: 4, [GL.SRGB8]: 4, [GL.RGB8_SNORM]: 4, [GL.RGB8UI]: 4, [GL.RGB8I]: 4,
    [GL.RGBA8]: 4, [GL.SRGB8_ALPHA8]: 4, [GL.RGBA8_SNORM]: 4, [GL.RGBA8UI]: 4, [GL.RGBA8I]: 4,
    [GL.RGB10_A2]: 4, [GL.RGB10_A2UI]: 4, [GL.R11F_G11F_B10F]: 4, [GL.RGB9_E5]: 4,
    [GL.RG16F]: 4, [GL.RG16UI]: 4, [GL.RG16I]: 4, [GL.R32F]: 4, [GL.R32UI]: 4, [GL.R32I]: 4,
    [GL.DEPTH_COMPONENT24]: 4, [GL.DEPTH_COMPONENT32F]: 4, [GL.DEPTH24_STENCIL8]: 4,
    [GL.RGB16F]: 8, [GL.RGBA16F]: 8, [GL.RGBA16UI]: 8, [GL.RGBA16I]: 8, [GL.RG32F]: 8,
    [GL.RG32UI]: 8, [GL.RG32I]: 8, [GL.DEPTH32F_STENCIL8]: 8,
    [GL.RGB32F]: 16, [GL.RGBA32F]: 16, [GL.RGBA32UI]: 16, [GL.RGBA32I]: 16,
  };
  const NAMES = {
    [GL.RGBA8]: "RGBA8", [GL.SRGB8_ALPHA8]: "SRGB8_A8", [GL.RGBA16F]: "RGBA16F", [GL.RGBA32F]: "RGBA32F",
    [GL.RGB8]: "RGB8", [GL.R8]: "R8", [GL.RG8]: "RG8", [GL.R16F]: "R16F", [GL.R32F]: "R32F",
    [GL.DEPTH24_STENCIL8]: "D24S8", [GL.DEPTH_COMPONENT24]: "D24", [GL.DEPTH_COMPONENT32F]: "D32F",
    [GL.DEPTH_COMPONENT16]: "D16", [GL.RGB16F]: "RGB16F", [GL.R11F_G11F_B10F]: "R11G11B10F",
  };
  // Unsized formats (WebGL1-style texImage2D): channels × bytes of `type`.
  const CHANNELS = { [GL.RGBA]: 4, [GL.RGB]: 4, [GL.RG]: 2, [GL.RED]: 1, [GL.LUMINANCE_ALPHA]: 2, [GL.LUMINANCE]: 1, [GL.ALPHA]: 1, [GL.DEPTH_COMPONENT]: 1, [GL.DEPTH_STENCIL]: 1 };
  const TYPE_BYTES = { [GL.UNSIGNED_BYTE]: 1, [GL.BYTE]: 1, [GL.HALF_FLOAT]: 2, [GL.FLOAT]: 4, [GL.UNSIGNED_SHORT]: 2, [GL.SHORT]: 2, [GL.UNSIGNED_INT]: 4, [GL.INT]: 4 };
  // Packed types: bytes per whole texel, whatever the channel count.
  const PACKED = { [GL.UNSIGNED_SHORT_4_4_4_4]: 2, [GL.UNSIGNED_SHORT_5_5_5_1]: 2, [GL.UNSIGNED_SHORT_5_6_5]: 2, [GL.UNSIGNED_INT_24_8]: 4, [GL.UNSIGNED_INT_2_10_10_10_REV]: 4, [GL.UNSIGNED_INT_10F_11F_11F_REV]: 4, [GL.UNSIGNED_INT_5_9_9_9_REV]: 4, [GL.FLOAT_32_UNSIGNED_INT_24_8_REV]: 8 };
  // Compressed formats: [block width, block height, bytes per block, name].
  const BLOCK = {};
  const block = (codes, w, h, bytes, name) => { for (const c of codes) BLOCK[c] = [w, h, bytes, name]; };
  block([0x83f0, 0x83f1, 0x8c4c, 0x8c4d], 4, 4, 8, "BC1");
  block([0x83f2, 0x83f3, 0x8c4e, 0x8c4f], 4, 4, 16, "BC2/3");
  block([0x8e8c, 0x8e8d, 0x8e8e, 0x8e8f], 4, 4, 16, "BC7/6H");
  block([0x8dbb, 0x8dbc], 4, 4, 8, "BC4");
  block([0x8dbd, 0x8dbe], 4, 4, 16, "BC5");
  block([0x9270, 0x9271, 0x9274, 0x9275, 0x9276, 0x9277], 4, 4, 8, "ETC2");
  block([0x9272, 0x9273, 0x9278, 0x9279], 4, 4, 16, "ETC2-A");
  const ASTC = [[4, 4], [5, 4], [5, 5], [6, 5], [6, 6], [8, 5], [8, 6], [8, 8], [10, 5], [10, 6], [10, 8], [10, 10], [12, 10], [12, 12]];
  ASTC.forEach(([w, h], i) => block([0x93b0 + i, 0x93d0 + i], w, h, 16, `ASTC${w}x${h}`));

  const texelBytes = (ifmt, type) => SIZED[ifmt] ?? PACKED[type] ?? (CHANNELS[ifmt] ?? 4) * (TYPE_BYTES[type] ?? 1);
  const levelBytes = (ifmt, w, h, type) => {
    const b = BLOCK[ifmt];
    if (b) return Math.ceil(w / b[0]) * Math.ceil(h / b[1]) * b[2];
    return w * h * texelBytes(ifmt, type);
  };
  const fmtName = (ifmt) => BLOCK[ifmt]?.[3] ?? NAMES[ifmt] ?? `0x${ifmt.toString(16)}`;
  const isCube = (t) => t >= GL.TEXTURE_CUBE_MAP_POSITIVE_X && t <= GL.TEXTURE_CUBE_MAP_NEGATIVE_Z;
  const sourceSize = (s) => [
    s?.naturalWidth || s?.videoWidth || s?.displayWidth || s?.width || 0,
    s?.naturalHeight || s?.videoHeight || s?.displayHeight || s?.height || 0,
  ];

  /** Per texture: { levels: Map("face:level" -> bytes), w, h, fmt, attached }. */
  const textures = new Map();
  const renderbuffers = new Map();
  const buffers = new Map();
  const states = new WeakMap();
  const contexts = new Set();
  const state = (gl) => {
    let s = states.get(gl);
    if (!s) {
      s = { unit: 0, tex: new Map(), rb: null, buf: new Map(), vao: null, vaoElem: new Map() };
      states.set(gl, s);
      contexts.add(gl);
    }
    return s;
  };
  const boundTex = (gl, target) => {
    const s = state(gl);
    const bindTarget = isCube(target) ? GL.TEXTURE_CUBE_MAP : target;
    return s.tex.get(s.unit * 65536 + bindTarget) ?? null;
  };
  // Each entry keeps its context: a lost one (R3F's unmount forces the loss)
  // has freed everything, so the report leaves its entries out.
  const entry = (gl, tex) => {
    let e = textures.get(tex);
    if (!e) { e = { gl, levels: new Map(), w: 0, h: 0, fmt: 0, attached: false }; textures.set(tex, e); }
    return e;
  };
  const setLevel = (gl, tex, key, bytes, w, h, fmt) => {
    if (!tex) return;
    const e = entry(gl, tex);
    e.levels.set(key, bytes);
    if (key.endsWith(":0") || !e.w) { e.w = w; e.h = h; e.fmt = fmt; }
  };

  const P = GL.prototype;
  const wrap = (name, after) => {
    const orig = P[name];
    if (!orig) return;
    P[name] = function (...args) {
      const r = orig.apply(this, args);
      try { after(this, args, r); } catch { /* the ledger must never break rendering */ }
      return r;
    };
  };

  // The binds run hundreds of times a frame: fixed-arity wrappers, which
  // allocate nothing (rest arguments would, and the memory probe weighs every
  // frame's garbage).
  const wrap2 = (name, after) => {
    const orig = P[name];
    if (!orig) return;
    P[name] = function (a, b) {
      orig.call(this, a, b);
      try { after(this, a, b); } catch { /* the ledger must never break rendering */ }
    };
  };
  const wrap1 = (name, after) => {
    const orig = P[name];
    if (!orig) return;
    P[name] = function (a) {
      orig.call(this, a);
      try { after(this, a); } catch { /* the ledger must never break rendering */ }
    };
  };
  // Texture bindings by unit and target, as small integer keys (no strings).
  const texKey = (unit, target) => unit * 65536 + target;
  wrap1("activeTexture", (gl, unit) => { state(gl).unit = unit - GL.TEXTURE0; });
  wrap2("bindTexture", (gl, target, tex) => { const s = state(gl); s.tex.set(texKey(s.unit, target), tex); });
  wrap("deleteTexture", (_gl, [tex]) => { textures.delete(tex); });
  wrap("texStorage2D", (gl, [target, levels, ifmt, w, h]) => {
    const tex = boundTex(gl, target);
    const faces = target === GL.TEXTURE_CUBE_MAP ? 6 : 1;
    for (let f = 0; f < faces; f++) {
      for (let l = 0; l < levels; l++) {
        setLevel(gl, tex, `${f}:${l}`, levelBytes(ifmt, Math.max(1, w >> l), Math.max(1, h >> l)), w, h, ifmt);
      }
    }
  });
  wrap("texStorage3D", (gl, [target, levels, ifmt, w, h, d]) => {
    const tex = boundTex(gl, target);
    for (let l = 0; l < levels; l++) {
      const depth = target === GL.TEXTURE_3D ? Math.max(1, d >> l) : d;
      setLevel(gl, tex, `0:${l}`, levelBytes(ifmt, Math.max(1, w >> l), Math.max(1, h >> l)) * depth, w, h, ifmt);
    }
  });
  wrap("texImage2D", (gl, args) => {
    const [target, level, ifmt] = args;
    let w, h, type;
    if (args.length === 6) { [w, h] = sourceSize(args[5]); type = args[4]; }
    else { w = args[3]; h = args[4]; type = args[7]; }
    const face = isCube(target) ? target - GL.TEXTURE_CUBE_MAP_POSITIVE_X : 0;
    setLevel(gl, boundTex(gl, target), `${face}:${level}`, levelBytes(ifmt, w, h, type), w, h, ifmt);
  });
  wrap("texImage3D", (gl, args) => {
    const [target, level, ifmt, w, h, d, , , type] = args;
    setLevel(gl, boundTex(gl, target), `0:${level}`, levelBytes(ifmt, w, h, type) * d, w, h, ifmt);
  });
  wrap("compressedTexImage2D", (gl, args) => {
    const [target, level, ifmt, w, h] = args;
    const face = isCube(target) ? target - GL.TEXTURE_CUBE_MAP_POSITIVE_X : 0;
    setLevel(gl, boundTex(gl, target), `${face}:${level}`, levelBytes(ifmt, w, h), w, h, ifmt);
  });
  wrap("copyTexImage2D", (gl, [target, level, ifmt, , , w, h]) => {
    const face = isCube(target) ? target - GL.TEXTURE_CUBE_MAP_POSITIVE_X : 0;
    setLevel(gl, boundTex(gl, target), `${face}:${level}`, levelBytes(ifmt, w, h, GL.UNSIGNED_BYTE), w, h, ifmt);
  });
  // generateMipmap fills levels a texImage2D-only texture never declared.
  wrap("generateMipmap", (gl, [target]) => {
    const tex = boundTex(gl, target);
    const e = tex && textures.get(tex);
    if (!e || !e.w) return;
    const faces = target === GL.TEXTURE_CUBE_MAP ? 6 : 1;
    const top = Math.floor(Math.log2(Math.max(e.w, e.h)));
    const base = e.levels.get("0:0") ?? 0;
    const perTexel = e.w * e.h ? base / (e.w * e.h) : 0;
    for (let f = 0; f < faces; f++) {
      for (let l = 1; l <= top; l++) {
        const key = `${f}:${l}`;
        if (!e.levels.has(key)) e.levels.set(key, Math.max(1, e.w >> l) * Math.max(1, e.h >> l) * perTexel);
      }
    }
  });
  wrap("framebufferTexture2D", (gl, [, , , tex]) => { if (tex) entry(gl, tex).attached = true; });
  wrap("framebufferTextureLayer", (gl, [, , tex]) => { if (tex) entry(gl, tex).attached = true; });

  wrap2("bindRenderbuffer", (gl, _target, rb) => { state(gl).rb = rb; });
  wrap("deleteRenderbuffer", (_gl, [rb]) => { renderbuffers.delete(rb); });
  wrap("renderbufferStorage", (gl, [, ifmt, w, h]) => {
    const rb = state(gl).rb;
    if (rb) renderbuffers.set(rb, { gl, bytes: levelBytes(ifmt, w, h), w, h, fmt: ifmt, samples: 1 });
  });
  wrap("renderbufferStorageMultisample", (gl, [, samples, ifmt, w, h]) => {
    const rb = state(gl).rb;
    if (rb) renderbuffers.set(rb, { gl, bytes: levelBytes(ifmt, w, h) * Math.max(1, samples), w, h, fmt: ifmt, samples });
  });

  wrap1("bindVertexArray", (gl, vao) => { state(gl).vao = vao; });
  wrap2("bindBuffer", (gl, target, buf) => {
    const s = state(gl);
    // The element binding belongs to the bound vertex array, not the context.
    if (target === GL.ELEMENT_ARRAY_BUFFER) s.vaoElem.set(s.vao, buf);
    else s.buf.set(target, buf);
  });
  wrap("deleteBuffer", (_gl, [buf]) => { buffers.delete(buf); });
  wrap("bufferData", (gl, [target, data, , srcOffset, length]) => {
    const s = state(gl);
    const buf = target === GL.ELEMENT_ARRAY_BUFFER ? s.vaoElem.get(s.vao) : s.buf.get(target);
    if (!buf) return;
    let bytes;
    if (typeof data === "number") bytes = data;
    else if (length) bytes = length * (data.BYTES_PER_ELEMENT ?? 1);
    else bytes = (data?.byteLength ?? 0) - (srcOffset ?? 0) * (data?.BYTES_PER_ELEMENT ?? 1);
    buffers.set(buf, { gl, bytes: Math.max(0, bytes) });
  });

  const MB = (b) => Math.round(b / 1e4) / 100;
  window.__gpuLedger = {
    /** A plain-JSON summary in bytes (and MB, 10^6, for reading). */
    report(top = 12) {
      let tex = 0, texCompressed = 0, rt = 0, rb = 0, buf = 0;
      const list = [];
      for (const e of textures.values()) {
        if (e.gl.isContextLost()) continue;
        let bytes = 0;
        for (const b of e.levels.values()) bytes += b;
        if (e.attached) rt += bytes;
        else { tex += bytes; if (BLOCK[e.fmt]) texCompressed += bytes; }
        list.push({ w: e.w, h: e.h, fmt: fmtName(e.fmt), mips: e.levels.size, rt: e.attached, bytes });
      }
      for (const r of renderbuffers.values()) {
        if (r.gl.isContextLost()) continue;
        rb += r.bytes;
        list.push({ w: r.w, h: r.h, fmt: fmtName(r.fmt), samples: r.samples, rt: true, renderbuffer: true, bytes: r.bytes });
      }
      for (const b of buffers.values()) if (!b.gl.isContextLost()) buf += b.bytes;
      let drawing = 0;
      const canvases = [];
      for (const gl of contexts) {
        if (gl.isContextLost()) continue;
        const a = gl.getContextAttributes() ?? {};
        const px = gl.drawingBufferWidth * gl.drawingBufferHeight;
        const samples = a.antialias ? 4 : 1;
        const perSample = 4 + (a.depth || a.stencil ? 4 : 0);
        const bytes = px * perSample * samples + (a.antialias ? px * 4 : 0);
        drawing += bytes;
        canvases.push({ w: gl.drawingBufferWidth, h: gl.drawingBufferHeight, antialias: !!a.antialias, bytes });
      }
      // Same size, format and role in one row: "11 × 2048×1024 SRGB8_A8".
      const groups = new Map();
      for (const x of list) {
        const key = `${x.w}x${x.h} ${x.fmt}${x.samples > 1 ? ` ×${x.samples}` : ""} ${x.rt ? "rt" : "tex"} ${x.mips}`;
        const g = groups.get(key) ?? { w: x.w, h: x.h, fmt: x.fmt, samples: x.samples ?? 1, rt: x.rt, mips: x.mips, count: 0, bytes: 0 };
        g.count++;
        g.bytes += x.bytes;
        groups.set(key, g);
      }
      const total = tex + rt + rb + buf + drawing;
      return {
        bytes: { textures: tex, texturesCompressed: texCompressed, renderTargets: rt + rb, buffers: buf, drawingBuffer: drawing, total },
        mb: { textures: MB(tex), renderTargets: MB(rt + rb), buffers: MB(buf), drawingBuffer: MB(drawing), total: MB(total) },
        counts: { textures: textures.size, renderbuffers: renderbuffers.size, buffers: buffers.size },
        canvases,
        groups: [...groups.values()].sort((x, y) => y.bytes - x.bytes).slice(0, top).map((g) => ({ ...g, mb: MB(g.bytes) })),
      };
    },
  };
}

/** Reads the ledger's report from the page (throws if it was not installed). */
export const readGpuLedger = (page, top = 12) => page.evaluate((n) => {
  if (!window.__gpuLedger) throw new Error("GPU ledger not installed: call installGpuLedger via evaluateOnNewDocument first");
  return window.__gpuLedger.report(n);
}, top);
