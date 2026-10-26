import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { encodePack, packTier } from './src/utils/packFormat.ts'
import { preloadFiles } from './src/utils/preloadChunks.ts'

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
  let assets: string[] = []
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
    generateBundle(_, bundle) {
      assets = Object.keys(bundle).filter((f) => f.startsWith('assets/')).sort()
    },
    closeBundle() {
      // Stamp the service worker with this build's files (public/sw.js prunes
      // the rest). The bytes change every build, so browsers install it anew.
      const sw = join(outDir, 'sw.js')
      writeFileSync(sw, readFileSync(sw, 'utf8').replace('/*__BUILD_ASSETS__*/[]', JSON.stringify(assets)))
      for (const p of Object.values(packs)) {
        writeFileSync(join(outDir, p.file), p.bytes)
        this.info(`asset pack ${p.file}: ${(p.bytes.length / 1048576).toFixed(2)} MB`)
      }
    },
  }
}

/**
 * <link rel="modulepreload"> for App's chunk and its static imports. main.tsx
 * imports App only after the content settles (App's modules read it when they
 * run), so without these App's code would start downloading only then, a
 * /content round trip late. modulepreload fetches without evaluating
 * (src/utils/preloadChunks.ts). Build only: dev serves modules one by one.
 */
function preloadApp(): Plugin {
  let base = '/'
  return {
    name: 'fitz-preload-app',
    apply: 'build',
    configResolved(c) {
      base = c.base
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html
        const chunks = Object.values(ctx.bundle).flatMap((c) =>
          c.type === 'chunk' ? [{ fileName: c.fileName, facadeModuleId: c.facadeModuleId, imports: c.imports }] : [])
        // Files the page already loads (the entry script).
        const skip = new Set(chunks.map((c) => c.fileName).filter((f) => html.includes(f)))
        const files = preloadFiles(chunks, '/src/App.tsx', skip)
        if (!files.length) this.error('fitz-preload-app: no chunk for src/App.tsx')
        return {
          html,
          tags: files.map((f) => ({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: `${base}${f}` }, injectTo: 'head' as const })),
        }
      },
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
  plugins: [react(), assetPack(), preloadApp()],
  // Agent worktrees under .claude/ are other branches' checkouts: their tests
  // read this checkout's public/ and fail on it.
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
})
