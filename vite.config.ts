import { defineConfig } from 'vite'

export default defineConfig({
  root: 'client',
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
    outDir: 'dist',
    sourcemap: true,
  },
})
