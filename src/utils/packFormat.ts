/**
 * The asset pack: every file under public/models joined into one download,
 * the way Unity (.data) and Godot (.pck) web builds ship their content.
 *
 * Layout (little-endian):
 *   "FPK1" | u32 index length N | N bytes of JSON index | file bytes, back to back
 *
 * Index offsets are relative to the start of the file bytes. Shared by the
 * build plugin (vite.config.ts, Node) and the loader (utils/assetPack.ts,
 * browser), so the two cannot disagree about the layout.
 */
export interface PackEntry { path: string; type: string; offset: number; length: number }

const MAGIC = [0x46, 0x50, 0x4b, 0x31]; // "FPK1"
const HEAD = 8;

export const PACK_TYPES: Record<string, string> = {
  glb: "model/gltf-binary",
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
};

export function encodePack(files: { path: string; bytes: Uint8Array }[]): Uint8Array {
  let offset = 0;
  const entries: PackEntry[] = files.map(({ path, bytes }) => {
    const ext = path.split(".").pop() ?? "";
    const e = { path, type: PACK_TYPES[ext] ?? "application/octet-stream", offset, length: bytes.length };
    offset += bytes.length;
    return e;
  });
  const index = new TextEncoder().encode(JSON.stringify(entries));
  const out = new Uint8Array(HEAD + index.length + offset);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, index.length, true);
  out.set(index, HEAD);
  let at = HEAD + index.length;
  for (const { bytes } of files) {
    out.set(bytes, at);
    at += bytes.length;
  }
  return out;
}

/** The index and where the file bytes start; throws on anything that is not a pack. */
export function decodePackIndex(buf: ArrayBuffer): { entries: PackEntry[]; dataStart: number } {
  const head = new Uint8Array(buf, 0, Math.min(HEAD, buf.byteLength));
  if (head.length < HEAD || MAGIC.some((b, i) => head[i] !== b)) throw new Error("asset pack: bad magic");
  const n = new DataView(buf).getUint32(4, true);
  if (HEAD + n > buf.byteLength) throw new Error("asset pack: truncated index");
  const entries = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, HEAD, n))) as PackEntry[];
  const dataStart = HEAD + n;
  for (const e of entries) {
    if (dataStart + e.offset + e.length > buf.byteLength) throw new Error(`asset pack: ${e.path} runs past the end`);
  }
  return { entries, dataStart };
}
