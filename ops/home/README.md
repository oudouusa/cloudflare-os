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

### Replace the earlier GLM 5.2 registration

The current Cloudflare OS UI exposes add and delete operations, but no in-place
model editor. Because the model ID changes, migrate through the application API
rather than rewriting Durable Object storage:

1. Add `deepseek-v4-flash` with the fields above while retaining `glm-5.2`.
2. Start a new chat and select `deepseek-v4-flash`. Do not click the provider row;
   that toggles **Quick model**, which remains unset during acceptance.
3. After provider admission is resolved and the bounded DeepSeek acceptance call
   succeeds, delete `glm-5.2` from its provider-row menu.

Chats created with `glm-5.2` retain that historical model ID. They may remain
viewable, but continuing them after the old registration is deleted can fail model
resolution; use a new DeepSeek chat and retain the owner-state backup. Do not edit
the live `.wrangler` volume or copy model credentials out of it.

Current owner state (2026-08-09): the owner-authorized migration completed through
the application's `UserDurableObject` API. The only registered model and preferred
model are `deepseek-v4-flash`; **Quick model** is unset. No inference was made by
the migration. The clean pre-migration rollback backup is
`/home/gpdmini/cloudflare-os-private-backups/20260808T220606Z`, and the checksummed
post-migration backup is `20260808T222719Z` under the same owner-only root. DeepSeek
provider admission now passes after the owner explicitly enabled the required
China-hosted deployment consent in the OpenCode web console. A first no-retry
16-token LiteLLM request ended during the model's reasoning preamble. One separately
approved no-retry 128-token request then returned HTTP 200/`completed`, with
reasoning in its own item and exactly `OK` in the final message item. The direct
LiteLLM semantic short-response bridge therefore passes; a complete **real-model**
in-app response and agent tool call remain open. The consent affects inference data
residency even
though OpenCode currently lists zero-day retention for this model. **Use balance**
remains OFF.

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

DeepSeek V4 thinking mode must not receive `tool_choice`. Cloudflare OS's normal
pi-ai path leaves it unset. The local LiteLLM callback exists for the separate
tool-result constraint: it replays the preceding `reasoning_content` and changes
only a null assistant content field to an empty string immediately before the
provider call. It also ignores content processing for DeepSeek stream metadata
chunks whose `choices` list is empty, while leaving those chunks in LiteLLM's
usage/final-response accumulator. LiteLLM 1.95.0 otherwise indexes `choices[0]`
and can fail after an HTTP-200 inference. Do not use the callback to silently
remove an explicitly requested tool choice.

## No-cost bridge QA

This starts LiteLLM and the local mock provider in a separate Compose project. The
mock overlay forcibly replaces the application and LiteLLM host ports with 18878
and 14002 and uses only `cloudflare-os-inapp-mock-*` volumes. It does not call
OpenCode or replace the always-on services:

```bash
docker compose -p cloudflare-os-deepseek-mock \
  --env-file ops/home/qa/mock.env \
  -f ops/home/compose.yaml -f ops/home/qa/compose.mock.yaml \
  up -d --wait mock-opencode litellm

docker compose -p cloudflare-os-deepseek-mock \
  --env-file ops/home/qa/mock.env \
  -f ops/home/compose.yaml -f ops/home/qa/compose.mock.yaml \
  exec -T litellm python /qa/check-deepseek-stream-guard.py

QA_LITELLM_BASE_URL=http://127.0.0.1:14002/v1 \
QA_LITELLM_MASTER_KEY=sk-litellm-mock-only \
QA_MOCK_BASE_URL=http://127.0.0.1:14100 \
node ops/home/qa/verify-litellm-bridge.mjs

QA_LITELLM_BASE_URL=http://127.0.0.1:14002/v1 \
QA_LITELLM_MASTER_KEY=sk-litellm-mock-only \
QA_MOCK_BASE_URL=http://127.0.0.1:14100 \
node ops/home/qa/verify-litellm-agent-bridge.mjs
```

The first verifier has six PASS lines. Its last two assertions prove exactly three
requests for the successful flow, then one deliberate `tool_choice` rejection with
no retry. The mock also rejects null assistant tool-call content and any missing or
changed reasoning replay. The Python regression check loads the callback inside
the pinned LiteLLM image and exercises all three guarded private helpers with an
empty choices list. With `CFOS_DEEPSEEK_COMPAT_TRACE=1` set only by the mock
override, its structure-only trace shows the four total completion dispatches and
never prints prompt or reasoning text. The second verifier proves five streaming
turns: `createGadget`, `writeFile` twice, `executeCode`, and final text. The
temporary diagnostic port is published only on `127.0.0.1:14100`.

For full in-app QA, start all three isolated services and use the fixed Playwright
checkout described in `docs/HOME_TESTING.md`:

```bash
docker compose -p cloudflare-os-deepseek-mock \
  --env-file ops/home/qa/mock.env \
  -f ops/home/compose.yaml -f ops/home/qa/compose.mock.yaml \
  up -d --wait

CFOS_PLAYWRIGHT_ROOT=/absolute/path/to/cloudflare-os-home/qa \
CFOS_BROWSER_BASE_URL=http://127.0.0.1:18878 \
CFOS_CONFIRM_ISOLATED_MOCK=yes \
node ops/home/qa/verify-inapp-mock.mjs
```

The script prints the created `agentUrl`. To prove persistence without a new model
request, restart only isolated Cloudflare OS, then pass that URL back:

```bash
docker compose -p cloudflare-os-deepseek-mock \
  --env-file ops/home/qa/mock.env \
  -f ops/home/compose.yaml -f ops/home/qa/compose.mock.yaml \
  restart cloudflare-os

CFOS_PLAYWRIGHT_ROOT=/absolute/path/to/cloudflare-os-home/qa \
CFOS_BROWSER_BASE_URL=http://127.0.0.1:18878 \
CFOS_CONFIRM_ISOLATED_MOCK=yes \
CFOS_VERIFY_WORKSPACE_URL='paste-the-agentUrl-here' \
node ops/home/qa/verify-inapp-mock.mjs
```

This uses intentionally public, inert mock credentials. It proves the UI, model
registration, streaming, tool events, Gadget files and test execution, rendered
`2 + 2 = 4` artifact, acceptance, reload/mobile behavior, and account/chat/Gadget
persistence after container restart. It does not prove that the real DeepSeek
model chose the tools.

Remove only this temporary project after the test. It never mounts the live
`.wrangler` volume, and `-v` remains forbidden:

```bash
docker compose -p cloudflare-os-deepseek-mock \
  --env-file ops/home/qa/mock.env \
  -f ops/home/compose.yaml -f ops/home/qa/compose.mock.yaml \
  down --remove-orphans
```

Never use `docker compose down -v`. The full-app verification volume is retained
by default; report it before any later manual cleanup.

## Daily operations

See `docs/HOME_OPERATIONS.md` for recovery, health, restart-loop, Tailscale, and
soak procedures. See `docs/BACKUP_RESTORE.md` before manipulating state.
