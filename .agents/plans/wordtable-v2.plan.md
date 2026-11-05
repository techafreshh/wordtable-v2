# Wordtable v2 plan (mirror of PRD-v2 §7)

Source of truth: `.agents/PRDs/PRD-v2.md`.

- **T0** Fresh repo scaffold (Vite TS, Zustand, GSAP, Howler, Vitest, CI) — ✅ done.
- **T1** Engine port: bag/board/dictionary.
- **T2** Rules: validation + scoring + reasons.
- **T3** Game state machine: turns, exchange, pass, six-scoreless, bag-empty, final scoring.
- **T4** LocalGame facade + scripted game.
- **T5** Tokens + board DOM/CSS.
- **T6** Rack + placement drag/tap + provisional score.
- **T7** Blank picker + commit/reject feedback.
- **T8** Player strip, chat + emotes, Howler sounds.
- **T9** Start/lobby/recap/setup screens + offline hot-seat loop.
- **T10** Three.js backdrop + fallback.
- **T11** Server harness (ws, rooms, tokens, v1 protocol verbatim).
- **T12** Server–game binding (private racks, timers, auto-pass).
- **T13** Client net module (store deltas).
- **T14** Reconnect UX + token rejoin + tab-reload resume.
- **T15** Network smoke + web e2e (static serve, scripted play, reload).
- **T16** Bot move generator.
- **T17** Bot in rooms + seeded soak (≥20 games, 0 illegal states).
- **T18** Polish sweep + PWA icons + README + `v0.1.0` tag.

Skills per task: see `docs/runbook.md` + the skill list in
`.agents/skills/.claude/skills` (symlinks to `~/.agents/skills/*`).
