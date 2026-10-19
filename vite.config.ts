import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { encodePack } from './src/utils/packFormat.ts'

/**
 * Production builds ship public/models as one hashed asset pack
 * (src/utils/packFormat.ts), loaded by src/utils/assetPack.ts, instead of
 * ~30 loose files. Build only: dev and the e2e harness keep the loose files.
 * ASSET_PACK=0 builds without it, for comparisons.
 */
function assetPack(): Plugin {
  let pack: Uint8Array | null = null
  let name = ''
  let outDir = ''
  return {
    name: 'fitz-asset-pack',
    apply: 'build',
    config() {
      if (process.env.ASSET_PACK === '0') return
      const dir = resolve('public/models')
      const files = readdirSync(dir).sort().map((f) => ({ path: `models/${f}`, bytes: readFileSync(join(dir, f)) }))
      pack = encodePack(files)
      name = `world.${createHash('sha256').update(pack).digest('hex').slice(0, 10)}.pack`
      return {
        define: {
          'import.meta.env.VITE_ASSET_PACK': JSON.stringify(name),
          // The true byte count for the progress bar: a server that compresses
          // the pack hides it (Content-Length is then the wire size, or absent).
          'import.meta.env.VITE_ASSET_PACK_SIZE': String(pack.length),
        },
      }
    },
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir)
    },
    closeBundle() {
      if (!pack) return
      writeFileSync(join(outDir, name), pack)
      rmSync(join(outDir, 'models'), { recursive: true, force: true })
      this.info(`asset pack ${name}: ${(pack.length / 1048576).toFixed(1)} MB`)
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
