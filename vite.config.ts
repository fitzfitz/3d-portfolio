import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { encodePack, packTier } from './src/utils/packFormat.ts'

/**
 * Production builds ship public/models as hashed asset packs
 * (src/utils/packFormat.ts), loaded by src/utils/assetPack.ts, instead of
 * ~30 loose files. Three packs: `hd` holds the `_4k` maps, `sd` the originals
 * they replace (an `x` with an `x_4k` sibling), `common` everything else; a
 * device downloads common plus one tier. Models come before textures in each
 * pack, so the loader can start parsing them while textures still stream.
 * The loose files still ship as the fallback. Build only: dev and the e2e
 * harness use the loose files. ASSET_PACK=0 builds without packs.
 */
function assetPack(): Plugin {
  const packs: Record<string, { file: string; bytes: Uint8Array }> = {}
  let outDir = ''
  return {
    name: 'fitz-asset-pack',
    apply: 'build',
    config() {
      if (process.env.ASSET_PACK === '0') return
      const dir = resolve('public/models')
      const names = readdirSync(dir)
      const order = (a: string, b: string) => Number(!a.endsWith('.glb')) - Number(!b.endsWith('.glb')) || a.localeCompare(b)
      for (const t of ['common', 'hd', 'sd']) {
        const files = names.filter((f) => packTier(f, names) === t).sort(order)
        const bytes = encodePack(files.map((f) => ({ path: `models/${f}`, bytes: readFileSync(join(dir, f)) })))
        packs[t] = { file: `world-${t}.${createHash('sha256').update(bytes).digest('hex').slice(0, 10)}.pack`, bytes }
      }
      const refs = Object.fromEntries(Object.entries(packs).map(([t, p]) => [t, { file: p.file, size: p.bytes.length }]))
      return { define: { 'import.meta.env.VITE_ASSET_PACKS': JSON.stringify(JSON.stringify(refs)) } }
    },
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir)
    },
    closeBundle() {
      for (const p of Object.values(packs)) {
        writeFileSync(join(outDir, p.file), p.bytes)
        this.info(`asset pack ${p.file}: ${(p.bytes.length / 1048576).toFixed(2)} MB`)
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Served from the domain root in dev and for a plain `npm run build`; the
  // Pages workflow sets BASE_PATH=/3d-portfolio/ because a GitHub project page
  // is served from a subpath. Kept as an env var rather than a literal so a
  // custom domain later is a config change, not a code change.
  //
  // This only fixes references Vite can see at build time. Runtime fetches of
  // string literals — every useGLTF/useTexture path — go through
  // src/utils/assetUrl.ts instead, and tests/assetUrl.test.ts fails if a bare
  // "/models/..." literal reappears.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), assetPack()],
})
