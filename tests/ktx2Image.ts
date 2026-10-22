import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * Decodes a KTX2 map (scripts/textures/encode_ktx2.mjs) in Node with the same
 * Basis transcoder the game ships (public/basis/, three's own), so map tests
 * read exactly the texels a GPU gets. Level 0 as 8-bit RGBA, rows top first
 * like the WebP it replaced (the file stores them bottom first for KTX2Loader).
 */
interface BasisModule {
  initializeBasis(): void;
  KTX2File: new (data: Uint8Array) => {
    isValid(): boolean; getWidth(): number; getHeight(): number; getLevels(): number;
    isUASTC(): boolean; getHasAlpha(): boolean; startTranscoding(): boolean;
    getImageTranscodedSizeInBytes(level: number, layer: number, face: number, format: number): number;
    transcodeImage(out: Uint8Array, level: number, layer: number, face: number, format: number, flags: number, channel0: number, channel1: number): number;
    close(): void; delete(): void;
  };
}

/** basisu's transcoder_texture_format cTFRGBA32. */
const RGBA32 = 13;
let basis: Promise<BasisModule> | null = null;

function loadBasis(): Promise<BasisModule> {
  basis ??= (() => {
    const src = readFileSync("public/basis/basis_transcoder.js", "utf8");
    // The emscripten module asks Node for require and __dirname when it finds itself there.
    const factory = new Function("require", "__dirname", `${src};return BASIS;`)(createRequire(import.meta.url), "public/basis") as (o: { wasmBinary: Buffer }) => Promise<BasisModule>;
    return factory({ wasmBinary: readFileSync("public/basis/basis_transcoder.wasm") }).then((m) => { m.initializeBasis(); return m; });
  })();
  return basis;
}

export interface Ktx2Info { w: number; h: number; levels: number; uastc: boolean; alpha: boolean }

export async function readKtx2(path: string): Promise<Ktx2Info & { data: Buffer; ch: 4 }> {
  const m = await loadBasis();
  const f = new m.KTX2File(new Uint8Array(readFileSync(path)));
  try {
    if (!f.isValid()) throw new Error(`${path}: not a valid KTX2 file`);
    const info = { w: f.getWidth(), h: f.getHeight(), levels: f.getLevels(), uastc: f.isUASTC(), alpha: f.getHasAlpha() };
    if (!f.startTranscoding()) throw new Error(`${path}: transcoding did not start`);
    const flipped = new Uint8Array(f.getImageTranscodedSizeInBytes(0, 0, 0, RGBA32));
    if (!f.transcodeImage(flipped, 0, 0, 0, RGBA32, 0, -1, -1)) throw new Error(`${path}: transcoding failed`);
    const row = info.w * 4;
    const data = Buffer.alloc(flipped.length);
    for (let y = 0; y < info.h; y++) data.set(flipped.subarray((info.h - 1 - y) * row, (info.h - y) * row), y * row);
    return { ...info, data, ch: 4 };
  } finally {
    f.close();
    f.delete();
  }
}
