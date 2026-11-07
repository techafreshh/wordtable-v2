// Server bundle config (issue #21) — emits the production single-port
// Node server as ESM `dist/server.js` from `server/src/ws.ts`. `ws` and
// node builtins stay external (resolved from `dependencies` at runtime);
// shared engine code bundles in. `emptyOutDir: false` so the client build
// (`vite build`, `dist/client/`) survives when this config runs second.
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const externals = new Set<string>([
  'ws',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
])

export default defineConfig({
  // No public dir: the client build already copies `public/` into
  // `dist/client/`; the server bundle must not duplicate it at `dist/`.
  publicDir: false,
  build: {
    emptyOutDir: false,
    outDir: 'dist',
    sourcemap: false,
    lib: {
      entry: 'server/src/ws.ts',
      formats: ['es'],
      fileName: () => 'server.js',
    },
    rollupOptions: {
      external: [...externals],
    },
  },
})
