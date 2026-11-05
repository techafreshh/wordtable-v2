# PRD v2: Wordtable on TypeScript + Three.js + Vite

| Field | Value |
|-------|-------|
| Product | **Wordtable** — Scrabble-style word game for 2–4 seats, same game as v1 |
| Status | Draft — rebuild of the v1 Godot project (`scrabble/` stays as reference) |
| Date | 2026-11-05 |
| Repo | **Fresh repo** (new directory). This Godot checkout is read-only reference; no Godot files are deleted here |

## 1. Why v2 exists

The v1 Godot 4 + GDScript implementation proves the full game works (rules, authoritative server, reconnect, bots, exports — all running in CI) but Godot's UI tooling is the bottleneck. Every screen (Start, lobby, table, recap) is a hand-placed Control tree, and dragging a tile, shading a premium square, or floating a score requires engine ceremonies instead of a one-line CSS change.

The fix is not better Godot nodes. It is the stack that gives HTML its speed back:

> **Vite + TypeScript + Three.js + Zustand + Howler + GSAP**

- **DOM owns the UI.** Board, racks, HUD, menus, modals, and chat are absolutely-positioned HTML/CSS rendered over the canvas. This is the single biggest quality lever: flex/grid layout, native drag/tap handling, `transform: 3d` tile flips, backdrop blur, and phone-safe touch behaviour for free.
- **Three.js owns the table backdrop.** A warmly lit felt table, soft shadows, subtle camera parallax — all dressing behind the DOM board. The game itself never depends on WebGL; a machine with WebGL blocked still plays.
- **State is a plain TS store.** Zustand is the bridge: the 3D scene and the DOM HUD both subscribe to the same store. No React — R3F adds render-loop friction for zero win when the 3D layer is mostly static dressing and the DOM does the interactive work.

### Explicitly out: Rapier, R3F, React

- **Rapier (`@dimforge/rapier3d-compat`) is not needed.** This is a turn-based board game. Tile placement is not a physics problem — it is a tween problem. GSAP/CSS keyframes handle board slam, rack rebound, score float-ups, and commit fanfare with frame-perfect easing and zero WASM load. Rapier stays reserved for the arcade driving games (danfo-style raycast/kinematic car controllers) where it belongs.
- **React Three Fiber is not needed.** R3F earns its keep when the 3D scene is the primary render target and the DOM is a thin overlay. Here it is the inverse: DOM is the game, Three.js is the backdrop. Vanilla Three + a JS store drives both without a component reconciliation layer in the animation path.

### What is worth copying from v1

v1 is not wasted. The engine is already proven against headless tests; v2 ports the proven parts and rewrites only the presentation layer.

| v1 artefact | v2 role |
|---|---|
| `dictionaries/sowpods.txt` + `LICENSE-credit.md` | Bundled lexicon (pluggable, one word/line) |
| `docs/protocol.md` | Wire protocol is unchanged — Node server speaks the same `{v:1, m:method}` JSON |
| `scripts/game/**` (bag, board, rules, game) | Behavioural spec for the TS engine: 15×15 premiums, 100-tile bag + blanks, banking, 50-pt bingo, 6-scoreless ending, empty-bag bonus, tournament final scoring |
| `scripts/server/rooms.gd` + `game_binding.gd` | Behavioural spec for room/session/timer behaviour |
| `scripts/server/bot.gd` | Bot algorithm reference: greedy-crossword with jitter, deterministic 5–15s think delay |
| `assets/sounds/{bag,thunk,fanfare}.wav` | Audio seeds for Howler (re-synthesize or re-record for v2) |
| `themes/warm_club.tres` | Colour/type palette source: dark wood, green felt, ivory, brass |

## 2. Product (v2 scope)

Scope is identical to v1 MVP except server language and first ship order. "Scrabble" stays neutral as "Wordtable" for IP reasons.

### In scope
- **Offline Play now (ships first):** Start → seat picker (2–4 named seats, optional bot seats) → offline table over the same TS engine. No server, no room code.
- **Online rooms (second cut):** create → join → start → place/pass/exchange, `add_bot` → `Botgomery`, strict-token rejoin/resync, 4-letter codes, 2–4 seats.
- **Full official rules** (see §1 table), dictionary-validated, server-authoritative online; locally valid offline.
- **Bot seat** fills any empty seat (greedy-crossword reference algorithm, jitter, 5–15s think delay).
- **Turn clock:** 90s default clock on; 180s stall-guard when clock off; every pass counts as scoreless.
- **End-of-game:** recap podium + final scores + word history + one-click rematch (same seats, fresh bag).
- **Chat + emotes:** lobby/table chat, three one-tap emotes, name ≤16 chars, text ≤200 chars, truncated never rejected.
- **Audio:** subtle thunk/fanfare/bag sounds + persistent mute (Howler).
- **Feel (the v2 payoff):**
  - Drag & drop from rack to board (mouse + touch), with tap-tile → tap-square fallback.
  - Pending tiles raised with soft outline; live provisional score as tiles are arranged (shared validator).
  - Blank letter-picker modal; reject bounce-back with friendly inline `Not in my book: WORD`.
  - Commit thunk + score-fly; rack refill slide; last-move highlight; "Big board" layout (score strip top, board center, rack bottom, chat as corner bubble).
  - Three.js table backdrop with ambient motion + parallax tied to pointer; board rendered in DOM with CSS 3D tilts so it reads as part of the table.
  - Warm club palette preserved unless a new art direction is approved first.

### Out of scope (deferred, same as v1)
Accounts, persistent stats, play-over-days, notifications, spectators, matchmaking, tournaments, challenge rule, move undo after commit, second lexicon picker, cross-device saved games, Android/iOS stores, executed VPS deploy.

## 3. Architecture

```
wordtable-v2 (fresh repo)
├── client (Vite SPA)               ← renders board, sends intents
├── server (Node ws)                ← owns ALL game state, arbitrates (authoritative)
└── shared/                         ← pure TS engine imported by both
    └── engine/                     ← bag, board, rules, dictionary, game, bot
```

### Key architecture points

- **Shared engine, two runtimes.** `shared/engine/` is pure TypeScript, scene-independent, with zero Three/DOM deps. The Node server uses it authoritatively; the client uses the same validators for provisional scores; Vitest runs it directly. This avoids re-implementing rules twice.
- **Single-page app from one Vite build.** Client is one SPA; screens are DOM views toggled by the store. Server is a separate Node process (see §4). The Node process can also **serve the Vite build statically** as a convenience for local/staging single-port deploys, but the client must still work against a standalone `ws://` / `wss://` server URL.
- **Store as source of truth.** Zustand holds seats, board, racks, turn, scores, pending placement, chat, connection status. Both the Three.js backdrop and the DOM subscribe. DOM renders from store; user intents dispatch actions write back to store. No DOM node holds trusted game state.
- **Back-buffer WebGL.** Three.js renders only the table dressing (felt plane, light, particles). Board/tiles/HUD are HTML over it. If WebGL fails or is disabled, the backdrop falls back to a CSS gradient — the game is unaffected.

### Client layout

```
client/
├── src/
│   ├── store/                  # Zustand stores
│   │   ├── game.ts             # seats, board, racks, turn, scores, history
│   │   ├── ui.ts               # screens, modals, drag state, toast
│   │   └── net.ts              # connection, room code, session token
│   ├── engine/                 # re-exported from shared/engine (provisional only)
│   ├── three/                  # backdrop renderer
│   │   ├── table.ts            # felt plane, lights, shadows
│   │   └── parallax.ts         # pointer-driven camera drift
│   ├── components/             # DOM UI — each a TS class or tiny component
│   │   ├── Board.tsx?          # plain TS template strings + event delegation
│   │   ├── Rack.tsx
│   │   ├── Tile.tsx
│   │   ├── PlayerStrip.tsx
│   │   ├── ChatBubble.tsx / ChatPanel.tsx
│   │   ├── StartScreen.tsx / Lobby.tsx / Recap.tsx / Setup.tsx
│   │   ├── BlankPicker.tsx / Toast.tsx / ReconnectOverlay.tsx
│   │   └── SoundToggle.tsx
│   ├── audio/                  # Howler bank (thunk, fanfare, bag, error)
│   └── main.ts                 # bootstraps store, backdrop, router
└── styles/
    ├── tokens.css              # Warm club palette, spacing, type
    ├── board.css               # 15×15 grid, premium shading, tile 3D
    └── fx.css                  # GSAP/CSS keyframes: flip, slam, float, glow
shared/engine/
├── bag.ts                      # 100-tile distribution, seeded shuffle
├── board.ts                    # premium layout, "H8" ↔ rc algebra, line extraction
├── dictionary.ts               # SOWPODS loader (pluggable path)
├── rules.ts                    # move validation + scoring + per-failure reasons
├── game.ts                     # turn state machine (enums, endings, final scoring)
├── local.ts                    # LocalGame facade: intents → events
├── bot.ts                      # move generator (greedy-crossword reference)
└── index.ts
server/
├── src/
│   ├── ws.ts                   # raw WebSocket listener, JSON envelope, ping→PONG
│   ├── rooms.ts                # room registry, session tokens, seat management
│   ├── binding.ts              # intents → LocalGame, private racks, broadcasts
│   ├── timers.ts               # per-turn deadline, stall guard, auto-pass
│   ├── bot-seat.ts             # think delay, commit/pass on bot turns
│   └── config.ts               # PORT, server URL, turn limits, lexicon path
└── package.json                # tsx/ts-node; vitest workspace root
tests/
├── engine/                     # vitest unit suites (port of v1 tests)
├── server/                     # rooms/binding/timer/chat private-rack suites
└── e2e/                        # Playwright or node ws probe: create→join→start→play
```

### Tech choices (confirmed)

| Layer | Choice | Why |
|---|---|---|
| Build | Vite + TypeScript | One codebase for browser, instant dev server, single static build |
| 3D | Three.js (vanilla, no R3F) | Backdrop dressing only; DOM owns interactivity |
| UI | DOM + CSS (plain TS components, template strings) | The quality lever — layout, touch, accessibility, cheap polish |
| Motion | GSAP + CSS keyframes | Tweens/sequences for flips, slams, floats. No physics engine needed |
| State | Zustand (vanilla) | Tiny store bridging scene ↔ HUD; no React render loop |
| Audio | Howler.js | HTML5 fallback, volume/mute, persisted `Sound: On/Off` |
| Transport | Raw `ws` (Node) JSON — same protocol as v1 | No framework churn; phone-safe; TLS via Cloudflare in front |
| Lexicon | Bundled `sowpods.txt` (one word/line) | Same file as v1; pluggable path |
| Testing | Vitest (engine/server) + ws probe / Playwright (e2e) | Headless CI gate, same philosophy as v1 (`RESULT: PASS` equivalent) |
| CI | GitHub Actions: `npm ci`, typecheck, vitest, ws smoke | v1's 4-job CI collapsed to one lane |

## 4. Server & protocol

Server is **Node + `ws`**, authoritative. It speaks the v1 wire protocol verbatim (see `docs/protocol.md` in this repo as the build source). Highlights:

- Transport is raw WebSocket text frames, one JSON object per frame (UTF-8). Client→server objects carry `{v:1, m:method}` (`version`/`method` accepted as aliases).
- Server replies carry `m` echo + `ok: true|false` + `error: <CODE>` on failure. The first frame for a request is the reply; later frames are broadcasts fanned out to every socket mapped to the room code.
- Bare text `ping` (case/whitespace tolerant) still answers `PONG` and never touches the RPC layer.
- Rooms: 4-letter uppercase codes, max 4 seats. Host is seat 0.
- Session token stored per-device (client); rejoin with same `{code, token}` yields a full `state_sync` snapshot (board_tiles, scores, own private rack, turn). Unknown token → `BAD_TOKEN`, never mints a seat.
- Private racks: replies `get_rack`/debug pins go to requestor only; broadcasts are personalized per recipient seat (own `rack` + `you` marker).
- Bot: host `add_bot` seats `Botgomery` (`is_bot: true`). When the turn reaches a bot seat, server waits deterministic 5–15s (`5 + abs(seed) % 11`), commits one greedy-crossword move (broadcast `bot_move: true`), passes if no legal move.
- Timers: `timer_on` default true (90s); `timer_off` → 180s stall guard. `turn_secs` (aliases `timer_secs`, `turn_timeout`, `timeout_secs`, `turn_limit_secs`) clamped 1–3600. Auto-pass broadcast `auto_pass: true`; every pass is scaleless.
- Methods (unchanged): `create_room`, `join_room`, `rejoin`/`resync`, `add_bot`, `remove_bot`, `start_game`, `rematch`, `place_tiles`/`place`, `pass`/`pass_turn`, `exchange`, `recall`, `shuffle_rack`/`shuffle`, `get_rack`/`rack`, `debug_set_rack`/`debug_set_bag` (test rooms only), `chat`, `emote`. Errors: `NO_ROOM`, `ROOM_FULL`, `NOT_HOST`, `NO_TOKEN`, `BAD_TOKEN`, `BAD_STATE`, `NOT_YOUR_TURN`, `NEED_OPPONENT`, `NOT_IN_LEXICON`, `BAD_TILES`, `BAD_TEXT`, `BAD_JSON`, `BAD_VERSION`, `UNKNOWN_MESSAGE`.
- Intents carry aliases (`code`/`room`/`room_code` case-insensitive, `token`/`session`/`session_token`, `name`/`player`/`player_name`, `tiles`/`placements`); squares as `H8` or `8H` (`A–O` col, `1–15` row).
- Config: `PORT` (default 9080), `--port` CLI > env; client server URL from `--server-url` / `WORDTABLE_SERVER_URL` (default `ws://localhost:9080`). Deployed behind Cloudflare Tunnel as `wss://` (see `docs/runbook.md` in this repo — systemd + tunnel configs reuse verbatim; only the exec Start changes to `node dist/server.js`).

## 5. UI / 3D art direction

### Visual bar

Preserve **Warm club**: dark wood, green felt board, ivory tiles, brass accents, "big board" layout. v2 upgrades execution:

- Board gets a slight CSS 3D tilt (perspective rotateX a few degrees) so it reads as sitting on the table; tiles live in DOM with `translateZ` depth and layered shadows for the ivory feel.
- Three.js backdrop: felt plane filling the viewport, warm key light, soft shadow blob under board, ambient dust particles, slow pointer parallax (board container parallaxes opposite the camera for depth). Backdrop never intercepts pointer events (`pointer-events: none`).
- Tile feel: rack tiles have index-tab corner + subtle bevel; pending tiles raise with outline; commit plays a GSAP slam (scale + y) synced to Howler thunk; rejects slide back to rack with a shake and toast.
- Board feedback: last-move squares glow briefly; provisional score chip floats above the pending line; invalid-word reject uses the same copy as v1 (`Not in my book: WORD`), not a harsh error state.
- Responsive: phone-first. Board scales to min(viewport) with touch targets ≥44px. Rack, Play/Recall/Shuffle controls reachable with one thumb. Chat bubble as a corner button with unread badge opening a panel with emote row.

### Motion & sound (GSAP/Howler)

| Moment | Motion | Sound |
|---|---|---|
| Commit | Tile slam + board pulse + score float-up | Howler `thunk` |
| Game over | Backdrop dim + confetti-lite (CSS particles) | `fanfare` |
| New deal / bag draw | Rack tiles deal-in stagger | `bag` |
| Reject | Rack shake + tile slide-back | soft click |
| Turn to player | Player strip glow + timer ring sweep | none (or tiny tick) |

Sound toggle persists to `localStorage` (`Sound: On/Off`); nickname persists per-device. Volume sliders per bus (master/thunk/fanfare) served via Howler.

### Screens

Start (nickname → Create / Join / Play now) → Offline seat picker → Lobby (seat plaques, bot toggle, timer toggle, code + copy link) → Table (player strip, board, rack, controls, chat) → Recap (podium, word history, rematch) + Reconnect overlay on drop.

## 6. Testing gates (must all hold in CI)

- **Engine:** full Vitest suites mirroring v1 coverage — bag distribution (official 100 tiles + blanks), board premiums + `H8` algebra, dictionary load (<3s, ≥200k), rules (first move, line/adjacency, premiums, blanks = 0, bingo, per-failure reason classes), game state (turns, exchange gate, six-scoreless, bag-empty ending, final scoring + unplayed-tile bonuses, rematch reset), facade `LocalGame` intents, bot generation, soak.
- **Server:** room registry (codes, seat cap, host-only), chat truncation (16/200), private racks, bot seating + think delay + commit/pass, timers (auto-pass fires), strict-token rejoin (identity vs `BAD_TOKEN`).
- **E2E:** scripted ws probe — create → join → start → place legal + reject illegal (`NOT_IN_LEXICON`) → pass → forced drop → rejoin resync identical → six-scoreless full game; web build smoke (static serve + scripted play + tab-reload resume). Final soak: **seeded bot-vs-bot soak (20 games, 0 illegal states)**.
- **Quality:** client never trusted (hacked client can't cheat), reconnect <3s on localhost, server frame-per-move <50ms in Node.

## 7. Build order (phases → tasks)

| Phase | Goal | Deliverables | Validation |
|---|---|---|---|
| **P1 — Engine** | Pure TS core, fully tested | `shared/engine/{bag,board,dictionary,rules,game,local}.ts` + Vitest suites (ported from v1) | `vitest` green; dictionary load <3s |
| **P2 — Table UI** | Playable local table, Warm club, touch-first | Vite SPA scaffold, Zustand stores, GSAP/HM tokens, Board/Rack/Tile/Strip/Chat, drag+tap placement, provisional scoring, all screens behind feature flag, offline hot-seat loop, sounds + mute | Vitest UI/component suites + Playwright phone-viewport walk |
| **P3 — Three.js backdrop** | Table depth + motion | Three.js felt plane, lights, particles, parallax, WebGL fallback gradient | Backdrop renders behind DOM; game runs with WebGL disabled |
| **P4 — Server** | Live online tables with reconnect | Node `ws` harness, rooms, sessions, timers/auto-pass/stall guard, broadcasts, token rejoin, §4 protocol full surface | ws probe suite green (create/join/start/place/reject/pass/rejoin) |
| **P5 — Bot** | Bot fills any seat | `shared/engine/bot.ts` + server bot-seat binding (thin + jitter) | Seeded soak: 20 games, 0 illegal states |
| **P6 — Ship** | One codebase, many screens | Web build + static serve, PWA shell, README, CI parity with §6, `v0.1.0` tag | E2E green; bundle size budget checked |

### Task IDs (each ≈ one GitHub issue)

- **T0** Fresh repo scaffold (Vite TS, Zustand, GSAP, Howler, Vitest, lint, CI lane); `npm run dev` serves empty Start screen.
- **T1** Engine port: bag/board/dictionary (`sowpods.txt` bundled, credit file alongside).
- **T2** Rules: validation + scoring + per-failure reasons (gold corpus).
- **T3** Game state machine: turns, exchange, pass, six-scoreless, bag-empty, final scoring, rematch.
- **T4** `LocalGame` facade + scripted 3-player game.
- **T5** Design tokens + board DOM/CSS (premiums, tile 3/3D, responsive/phone).
- **T6** Rack + placement (drag & drop + tap-tap, provisional score via shared validator).
- **T7** Blank picker; commit/reject feedback; toast copy.
- **T8** Player strip (active glow + timer ring), chat bubble + emotes, sounds + mute (Howler).
- **T9** Start / lobby / recap / offline seat picker screens + full hot-seat loop.
- **T10** Three.js table backdrop (felt, light, particles, parallax) + WebGL fallback.
- **T11** Server harness: WS listener, rooms, tokens, versioned protocol (§4).
- **T12** Server–game binding: private racks, timers, auto-pass, scoreless counting.
- **T13** Client net module: connect/join, full `state_sync` + deltas into store.
- **T14** Reconnect UX: overlay, retry backoff, token rejoin, tab-reload resume.
- **T15** Network smoke suite + web e2e (static serve, scripted play, reload resume).
- **T16** Bot move generator + tests.
- **T17** Bot in rooms + seeded soak (≥20 games, 0 illegal states).
- **T18** Polish sweep (motion/audio audit), PWA icons/splash, runbook exec checklist, README, `v0.1.0`.

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Board-at-phone scale | Touch misses, fat-finger placements | DOM board with 44px targets + `touch-action` tuning; drag + tap-tap both exercised in T8/T9 tests |
| WebGL unavailable/blocked | No backdrop | Hard fallback gradient; game never depends on WebGL (P3 acceptance) |
| Protocol drift | Client/server mismatch after port | v1 `protocol.md` treated as frozen contract; ws-probe parity tests in CI |
| Bot perf in TS | Slow turns | Keep v1's time-budgeted greedy reference (<300ms/turn target); soak gates before polish |
| Art-direction scope creep | Endless asset polish | Warm club palette frozen from v1; new direction requires a separate decision |
| Two-repo drift | Rules diverge between Godot reference and TS | TS engine is source of truth going forward; Godot checkout stays read-only reference |
