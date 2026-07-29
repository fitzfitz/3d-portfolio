import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
  plugins: [react()],
})
