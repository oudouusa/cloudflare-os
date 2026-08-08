# Cloudflare OS home pilot

This directory runs the official Cloudflare OS source as a private, always-on
development pilot for this PC. It is an Early Access Wrangler/workerd development
environment, not a production deployment.

## Components

- `cloudflare-os`: this checkout, built with official CI's Node 22.14 line.
- `litellm`: pinned LiteLLM v1.95.0, exposing one OpenCode Go
  `deepseek-v4-flash` route.
- `.wrangler` named volume: accounts, chats, Gadgets, and connection state.
- pnpm named volume: disposable dependency cache.
- optional mock provider: no-cost Responses-to-Chat regression tests.

The host binds only `127.0.0.1:8877` and `127.0.0.1:4001`.

## One-time local setup

```bash
cp ops/home/.env.example ops/home/.env
chmod 600 ops/home/.env
```

Edit `.env` without echoing credentials to the terminal. Replace the two dummy
values with the OpenCode Go API key and a newly generated LiteLLM master key. Do
not reuse another application's proxy key. Before any real model call, confirm in
the OpenCode account UI that **Use balance is OFF**.

Set `PUBLIC_BASE_URL` to this PC's exact Tailscale HTTPS origin. The helper below
derives it from local Tailscale status and atomically replaces only that field; it
does not print the hostname or either credential. Then run the secret-safe
preflight:

```bash
node ops/home/scripts/set-tailscale-public-base.mjs
node ops/home/qa/check-private-env.mjs
```

Build and validate:

```bash
docker compose --env-file ops/home/.env -f ops/home/compose.yaml config --quiet
docker compose --env-file ops/home/.env -f ops/home/compose.yaml build cloudflare-os
```

Start:

```bash
docker compose --env-file ops/home/.env -f ops/home/compose.yaml up -d
docker compose --env-file ops/home/.env -f ops/home/compose.yaml ps
```

Open `http://127.0.0.1:8877`. Use the loopback IP rather than `localhost` so the
frontend remains on the intended same origin. For this official local-dev server,
create the owner with username `admin`: `run-dev-server.js` designates that exact
local username as the administrator. Choose a private password that is never put
in QA scripts or evidence, verify login, then disable additional signups in Admin
settings.

## Register the OpenCode Go model

In Cloudflare OS, add an `Other OpenAI` model with:

- model ID: `deepseek-v4-flash`
- display name: `OpenCode Go DeepSeek V4 Flash`
- base URL: `http://litellm:4000/v1`
- API key: the local `LITELLM_MASTER_KEY`, not the OpenCode key

The service name is required inside Docker. Do not use `localhost:4001` in the
Cloudflare OS form. Keep this as the only MVP model and do not configure a fallback.
Leave **Quick model** unset during acceptance so title generation cannot create
extra provider calls.

## Private remote access

After reviewing the existing Serve state and receiving approval, configure the
single tailnet-only route. On this PC the Tailscale daemon requires `sudo`; no
operator setting is changed:

```bash
sudo tailscale serve --bg http://127.0.0.1:8877
tailscale serve status --json
```

Rollback is `sudo tailscale serve reset`. Never enable Funnel. From WSL, run the
Windows-node HTTPS/WSS smoke without printing the private origin:

```bash
cfos_tail_url=$(node --input-type=module -e \
  'import {readFileSync} from "node:fs"; for(const l of readFileSync("ops/home/.env","utf8").split(/\r?\n/)){const m=l.match(/^PUBLIC_BASE_URL=(.*)$/); if(m){process.stdout.write(m[1].trim()); break}}')
cfos_ps_script=$(wslpath -w ops/home/qa/tailscale-windows-smoke.ps1)
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass \
  -File "$cfos_ps_script" -BaseUrl "$cfos_tail_url"
unset cfos_tail_url cfos_ps_script
```

Run one short normal chat and one minimal agent tool flow only after the cost gate
in `docs/COST_GUARDRAILS.md` is satisfied.

## No-cost bridge QA

This starts only LiteLLM and the local mock provider in a separate Compose project;
it does not call OpenCode or replace the always-on services:

```bash
LITELLM_HOST_PORT=14002 \
LITELLM_MASTER_KEY=sk-litellm-mock-only \
OPENCODE_GO_API_KEY=mock-opencode-key \
docker compose -p cloudflare-os-deepseek-mock \
  -f ops/home/compose.yaml -f ops/home/qa/compose.mock.yaml \
  up -d --wait mock-opencode litellm

QA_LITELLM_BASE_URL=http://127.0.0.1:14002/v1 \
QA_LITELLM_MASTER_KEY=sk-litellm-mock-only \
node ops/home/qa/verify-litellm-bridge.mjs
```

Remove only this temporary project after the test. It never mounts the live
`.wrangler` volume, and `-v` remains forbidden:

```bash
LITELLM_HOST_PORT=14002 \
LITELLM_MASTER_KEY=sk-litellm-mock-only \
OPENCODE_GO_API_KEY=mock-opencode-key \
docker compose -p cloudflare-os-deepseek-mock \
  -f ops/home/compose.yaml -f ops/home/qa/compose.mock.yaml \
  down --remove-orphans
```

Never use `docker compose down -v`.

## Daily operations

See `docs/HOME_OPERATIONS.md` for recovery, health, restart-loop, Tailscale, and
soak procedures. See `docs/BACKUP_RESTORE.md` before manipulating state.
