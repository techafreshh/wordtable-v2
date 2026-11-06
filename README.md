# Wordtable v2

TypeScript + Vite rebuild of the Scrabble-style word game.

- **Client:** Vite SPA (DOM/CSS UI) over a Three.js felt backdrop.
- **Server:** Node `ws`, same wire protocol as the Godot prototype.

## Quickstart

```sh
npm ci
npm run dev        # client on :5173 + server on :9080 together
npm run server     # Node server on :9080 standalone (PORT=9090 or --port=9090 to override)
npm test           # vitest
```

Offline "Play now" needs no server. Online rooms need both processes.

## Packages

| What | Where | Notes |
|---|---|---|
| Build | Vite 6 | ESM-only, `vite.config.ts` |
| UI | DOM + CSS | Warm club palette in `client/src/styles/tokens.css` |
| 3D | Three.js (vanilla) | Backdrop only; game never depends on WebGL |
| State | Zustand | Store bridges scene ↔ HUD |
| Audio | Howler | `thunk`/`fanfare`/`bag` from the prototype |
| Motion | GSAP + CSS keyframes | Tile slam, score float-ups, rack shake |
| Server | Node `ws` | Authoritative; see `server/src/` |

See `.agents/PRDs/PRD-v2.md` for the full spec (this initial scaffold only covers T0).
