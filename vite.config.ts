import { defineConfig } from 'vite'

export default defineConfig({
  root: 'client',
  publicDir: '../public',
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:9080',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../dist/client',
    sourcemap: true,
    // Only the idle-loaded decorative Three backdrop chunk may exceed
    // Vite's 500 kB default warning limit; initial-chunk bloat is still
    // gated by scripts/check-bundle.mjs (800 KiB gzip total).
    chunkSizeWarningLimit: 1024,
  },
})
