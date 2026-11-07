# Wordtable deployment runbook

Exec checklist for shipping and hosting v0.1.0. Run every command from the
repo root on the host (or your machine for the local checks).

## 1. Install and verify locally

```sh
npm ci
npm run typecheck
npm test
npm run soak -- --games 20 --seed 42
npm run build
node scripts/check-bundle.mjs
npm run test:e2e
```

All six must pass. `check-bundle` enforces the release budget: shipped
`dist/client/assets/*.js` must total under 800 KiB gzip.

## 2. Start the production server

The release artifact is a single Node process serving the SPA, the PWA
shell and the game socket on one port — no `tsx`, no Vite dev server:

```sh
node dist/server.js            # PORT=9080 by default
PORT=9090 node dist/server.js  # env override
node dist/server.js --port=9090  # CLI wins over env
```

`PORT` precedence is CLI-over-env-over-default (see
`server/src/config.ts`). Confirm the build serves:

```sh
curl -s http://localhost:9080/health          # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9080/
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:9080/manifest.webmanifest
```

Expect `200`, `{"ok":true}`, and
`200 application/manifest+json`.

## 3. systemd unit (autostart with restart)

Install as `/etc/systemd/system/wordtable.service`:

```ini
[Unit]
Description=Wordtable production server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=wordtable
WorkingDirectory=/opt/wordtable
Environment=PORT=9080
ExecStart=/usr/bin/node /opt/wordtable/dist/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Then:

```
sudo systemctl daemon-reload
sudo systemctl enable --now wordtable
journalctl -u wordtable -f   # journald log tail
```

Notes:

- `Restart=always` keeps the table up across crashes and reboots
  (`enable` wires it into boot).
- `PORT` env overrides the default `9080` (CLI `--port=NNNN` wins over
  env when both are set).
- All server output goes to stdout, so `journald` already captures it;
  no log files to rotate.

## 4. Cloudflare Tunnel (no open ports)

Serve secure `wss://` clients without opening firewall ports: run
`cloudflared` on the same host and point it at the local server.

`/etc/cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /etc/cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: play.example.com
    service: http://localhost:9080
  - service: http_status:404
```

Then:

```
cloudflare tunnel route dns <TUNNEL_ID> play.example.com
sudo systemctl enable --now cloudflared
```

Clients connect to `wss://play.example.com` (append
`?server-url=wss://play.example.com` or set `WORDTABLE_SERVER_URL`).
The Cloudflare Tunnel edge terminates TLS, so the game server itself
stays plain `ws://`/`http://` on localhost and the host firewall can
stay closed.

## 5. Domain checklist

- [ ] Domain registered and added to the Cloudflare account (nameservers
      pointing at Cloudflare).
- [ ] `play.<domain>` DNS record created by the `tunnel route dns`
      command above (proxied/orange cloud).
- [ ] Edge TLS mode `Full (strict)` or better; HSTS optional.
- [ ] Wait for certificate issuance, then open
      `https://play.<domain>` in a browser and confirm the table
      paints and `GET /health` returns `{"ok":true}`.
- [ ] Confirm a two-client smoke passes through the tunnel:
      `WORDTABLE_DEBUG=1 tsx tests/e2e/ws-probe.mts` prints
      `REJOIN_IDENTICAL` and `SIX_SCORELESS_END` (exits 0).

## 6. Environment knobs

| Knob | Where | Default | Effect |
|---|---|---|---|
| `PORT` | env / `--port=` | `9080` | TCP port the production server listens on |
| `WORDTABLE_SERVER_URL` | client env | `ws://localhost:9080` | server the clients dial (bundled default) |
| `VITE_WORDTABLE_SERVER_URL` | client env (Vite) | — | same as above; `?server-url=` query param wins over both |
| `timer_on` / `timer_off` | room `options` | on | per-turn clock vs. 180 s stall guard |
| `turn_secs` (aliases: `timer_secs`, `turn_timeout`, `timeout_secs`, `turn_limit_secs`, `limit_secs`) | room `options` | `90` (clock on) | per-turn limit, clamped 1–3600 s |
| lexicon | `dictionaries/sowpods.txt` | bundled | word validation; server boots without it but skips word checks |

Health checks after deploy: `curl /health` answers `{"ok":true}`; the CI
`ci` job runs typecheck, vitest, the 20-game soak, the production build,
the bundle-budget gate and the Playwright chromium walk (offline commit,
reload-resume, hot-seat loop, online bot game).

## 7. Release / tag

```sh
git status --short          # must be clean
git tag -a v0.1.0 -m 'v0.1.0 PWA shell, polish audit, README, runbook'
git push origin v0.1.0
```

Tag only from a tree where step 1 is fully green.
