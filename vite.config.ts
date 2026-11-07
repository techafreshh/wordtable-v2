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
  },
})
