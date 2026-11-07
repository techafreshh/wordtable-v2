# Wordtable v2

TypeScript rebuild of the Scrabble-style word game: offline hot-seat,
online rooms with bots, chat, and reconnect — wrapped in an installable
PWA shell served by a single-port Node server.

- **Client:** Vite SPA (DOM/CSS UI) over a Three.js felt backdrop.
- **Server:** Node `ws`, authoritative; same single-port process serves
  the built SPA, the PWA shell and the game socket.
- **PWA:** `public/manifest.webmanifest` + versioned `public/sw.js`
  (precaches `/`, cache-first same-origin GETs) + generated PNG icons;
  installable, paints offline.

## Install and play

```sh
npm ci
npm run dev        # client on :5173 + server on :9080 together
npm run server     # Node server on :9080 standalone (tsx, dev)
```

Offline "Play now" needs no server. Online rooms: open the client with
`?server-url=<ws-url>` (or set `WORDTABLE_SERVER_URL` /
`VITE_WORDTABLE_SERVER_URL`), Create/Join a room, add Botgomery with
`add_bot`, and play.

## Deploy (production)

```sh
npm run build      # clean dist/ + tsc + client bundle + dist/server.js
npm run serve      # node dist/server.js (PORT honored, default 9080)
curl -s http://localhost:9080/health   # {"ok":true}
```

Full checklist (systemd, Cloudflare Tunnel `wss`, env knobs, tag): see
`docs/runbook.md`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite client + `tsx` server together |
| `npm run server` | Dev server via `tsx server/src/ws.ts` |
| `npm run build` | Clean `dist/`, typecheck, client bundle, server bundle (`dist/server.js`) |
| `npm run clean` | Empty `dist/` (runs first in `npm run build`) |
| `npm run serve` | Production server: `node dist/server.js` |
| `npm run server:build` | Server bundle only (`vite.server.config.ts`) |
| `npm run check-bundle` | Fail unless shipped JS is <800 KiB gzip |
| `npm test` | Vitest (unit + static-serve + PWA assets) |
| `npm run soak` | Seeded bot-vs-bot engine soak |
| `npm run test:e2e` | Production build + ws probe + Playwright walk |
| `npm run typecheck` | `tsc -b` |

## Server URL resolution

`client/src/store/net.ts` resolves the dial target in this order:
`?server-url=` query param (any case) wins over
`VITE_WORDTABLE_SERVER_URL` / `WORDTABLE_SERVER_URL`, else the bundled
default `ws://localhost:9080`. The server side mirrors this with
CLI `--port=` over `PORT` over `9080` (`server/src/config.ts`).

## PWA install / offline

The built client links `manifest.webmanifest` (`theme-color #2e1a12`,
`apple-touch-icon`) and `main.ts` registers `/sw.js` (never-throw, so a
failed registration can never break the board). Icons are generated,
not designed: `node scripts/gen-icons.mjs` rewrites
`public/icon-192.png` / `public/icon-512.png` (Node `zlib` only) from a
5×7 brass "W" on wood-dark. Rebuild after editing `public/*`; the
server serves them with the manifest content-type
`application/manifest+json`.

## Motion / audio audit (v0.1.0)

- **Motion is CSS keyframes** (`client/src/styles/fx.css`: slam-in,
  shake-x, float-up, deal-in) plus the `.last-move` highlight — no
  animation library in the loop.
- **`gsap` was removed**: it shipped as a dependency with zero imports
  anywhere in `client/`, so wiring it in would only grow the bundle for
  identical visuals.
- **Audio is Howler, lazy**: `client/src/audio/bank.ts` dynamic-imports
  `howler` on first play (`thunk`/`fanfare`/`bag`/`error`), degrades to
  silent no-op without an AudioContext, and never blocks rendering.

## Server layout

| What | Where | Notes |
|---|---|---|
| Build | Vite 6 | ESM-only, `vite.config.ts` + `vite.server.config.ts` |
| UI | DOM + CSS | Warm club palette in `client/src/styles/tokens.css` |
| 3D | Three.js (vanilla) | Backdrop only; game never depends on WebGL |
| State | Zustand | Store bridges scene ↔ HUD |
| Audio | Howler | Lazy `bank.ts`, persisted mute flag |
| Server | Node `ws` | Authoritative; see `server/src/` |

See `.agents/PRDs/PRD-v2.md` for the full spec.
