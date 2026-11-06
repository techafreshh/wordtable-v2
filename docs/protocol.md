# Wordtable wire protocol (v1, unchanged for v2)

This document is the frozen contract between the v2 client and the Node server.
It is identical to `../docs/protocol.md` in the Godot prototype repo
(`scrabble/`). Do not drift — the ws-probe parity tests enforce it.

## Envelope

- Client → server objects carry `v: 1` and `m: <method>`.
  `version`/`method` are accepted aliases.
- Server replies carry `m` echo + `ok: true|false`. Errors carry `error: <CODE>`
  plus a `reason` alias with the same value.
- First frame for a request is always the reply; later frames are broadcasts
  fanned out to every socket mapped to the room code.
- Bare text `ping` (case/whitespace tolerant) still answers `PONG`.
- Names truncate to 16 chars, chat/emote text to 200 (trimmed, never rejected).

## Methods

| `m` | Needs | Reply (`ok:true`) |
|---|---|---|
| `create_room` | `name` | `code`, `token`, `seat:0`, `seats:1` |
| `join_room` | `code`, `name`, optional `token` | `code`, `token`, `seat`/`you`, `seats` |
| `rejoin` (`resync`) | `code`+`token` | full snapshot (`started`, `turn`, `scores`, `rack`, `board_tiles`, `over`, …) |
| `add_bot` | host `code`+`token` | `bot: Botgomery`, `bot_seat`, `seat: Botgomery`, `bot_seated: true`, `seats` |
| `remove_bot` | host `code`+`token`, optional `seat` | `seats` |
| `start_game` | host `code`+`token` | `started:true`, `turn`, `scores` |
| `rematch` | host `code`+`token` | `started:true`, `turn`, `scores` |
| `place_tiles` (`place`) | turn seat `code`+`token`, `tiles` | `accepted:true`, `points`, `turn`, `scores`, `over` |
| `pass` (`pass_turn`) | turn seat `code`+`token` | `accepted:true`, `turn` |
| `exchange` | turn seat `code`+`token`, `count` | `accepted:true`, `turn` |
| `recall` | turn seat `code`+`token` | `recalled`, `rack`, `turn` |
| `shuffle_rack` (`shuffle`) | turn seat `code`+`token` | `rack`, `turn` |
| `get_rack` (`rack`) | `code`+`token` | private `rack`, `seat`/`you`, `turn` |
| `debug_set_rack` | host, test rooms only | `seat`, `rack` |
| `debug_set_bag` | host, test rooms only | `bag_remaining` |
| `chat` | `code`+`token`, `text` | `chat_ok:true`, `from`, `text`, `ts` |
| `emote` | `code`+`token`, `text` | `emote_ok:true`, `from`, `text`, `ts` |

Chat/emote fan out to every seat in the room (lobby and table alike):
`{m:'chat', code, from, text, ts}` and
`{m:'emote', code, from, text, emote:text, ts}`. The emote frame carries
the value under both `text` and `emote` so `emote":"👏` holds on the wire.

## Error codes

`NO_ROOM`, `ROOM_FULL`, `NOT_HOST`, `NO_TOKEN`, `BAD_TOKEN`, `BAD_STATE`,
`NOT_YOUR_TURN`, `NEED_OPPONENT`, `BAD_JSON`, `BAD_VERSION`, `UNKNOWN_MESSAGE`,
`NOT_IN_LEXICON`, `BAD_TILES`, `BAD_TEXT`, and pass-through facade reasons.

See the prototype's `docs/protocol.md` for the full field-level transcript.
