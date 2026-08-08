# Home operations

## Start and inspect

Run commands from the repository root:

```bash
docker compose --env-file ops/home/.env -f ops/home/compose.yaml up -d
docker compose --env-file ops/home/.env -f ops/home/compose.yaml ps
curl --fail --silent --show-error http://127.0.0.1:8877/ >/dev/null
docker exec cloudflare-os-home-litellm-1 python -c \
  "import os,urllib.request; r=urllib.request.Request('http://127.0.0.1:4000/v1/models',headers={'Authorization':'Bearer '+os.environ['LITELLM_MASTER_KEY']}); raise SystemExit(0 if urllib.request.urlopen(r,timeout=10).status==200 else 1)"
```

Avoid placing a real master key in shell history. Prefer loading `ops/home/.env`
into a private shell session or an interactive secret-safe client. Never paste
health output that may contain identity or model metadata into public evidence.

## Diagnose unhealthy services

```bash
docker compose --env-file ops/home/.env -f ops/home/compose.yaml ps
docker compose --env-file ops/home/.env -f ops/home/compose.yaml logs --tail 200 litellm
docker compose --env-file ops/home/.env -f ops/home/compose.yaml logs --tail 200 cloudflare-os
docker inspect -f '{{.Name}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restarts={{.RestartCount}}' \
  $(docker compose --env-file ops/home/.env -f ops/home/compose.yaml ps -q)
```

Do not enable debug request-body logging. A nonzero or increasing restart count,
repeated `starting`, or rapid `unhealthy`/restart transitions indicate a loop.
Capture the bounded logs once, inspect the first cause, and stop the affected
service if the loop continues.

```bash
docker compose --env-file ops/home/.env -f ops/home/compose.yaml stop cloudflare-os
```

## Docker Desktop and WSL recovery

The Compose restart policy is `unless-stopped`. After Docker Desktop restarts,
check `docker info`, then `docker compose ... ps`. If containers were intentionally
stopped, `unless-stopped` preserves that state; start them explicitly. Confirm the
`.wrangler` volume name before troubleshooting application data:

```bash
docker volume inspect cloudflare-os-home-wrangler
```

Windows sleep suspends WSL2, Docker, and the pilot. No Windows startup task, power
plan, or systemd unit is changed by this repository. Any such automation needs a
separate proposal with rollback and explicit approval.

## Capacity observed on this PC

The 2026-08-08 no-inference main stack used about 739 MiB for Cloudflare OS and
824 MiB for LiteLLM at one sample (roughly 1.6 GiB combined; instantaneous CPU was
under 3%). This is an observation, not a resource limit. The pinned application
and LiteLLM images were about 404 MB and 374 MB, and the main pnpm cache volume was
about 1.0 GB. Fresh `.wrangler` state was about 7.4 MB before real chats/Gadgets.

An active restore-verification stack adds another Cloudflare OS, LiteLLM process,
and separate roughly 1.0 GB pnpm cache, although image layers are shared. Stop the
verification project after collecting evidence and retain its containers/volume
until cleanup is explicitly approved. For steady use, watch `docker stats` and
Docker Desktop disk usage; do not impose memory limits until a real agent flow has
been measured, because an arbitrary low limit can corrupt an in-progress local
operation.

## Tailscale Serve approval gate

Before changing Serve, save and review the existing state without exposing the
tailnet name in public output:

```bash
tailscale serve status --json
tailscale status --json
```

The intended change is one tailnet-only HTTPS route proxying to
`http://127.0.0.1:8877`. First update `PUBLIC_BASE_URL` without printing the private
origin so Gatekeeper OAuth redirects are correct:

```bash
node ops/home/scripts/set-tailscale-public-base.mjs
node ops/home/qa/check-private-env.mjs
```

Do not run a Serve mutation until the current JSON and exact command/rollback have
been shown to the owner and approved. Funnel, public Tunnel, router forwarding, and
a host `0.0.0.0` publish are forbidden. Once approved:

```bash
sudo tailscale serve --bg http://127.0.0.1:8877
tailscale serve status --json
```

Rollback is `sudo tailscale serve reset`. This PC uses `sudo` for the Serve
mutation; `tailscale set --operator` was deliberately not applied.

After approval, verify separately:

1. HTTPS page load over Tailscale.
2. A live WebSocket/agent update.
3. Reconnection after a container restart.
4. Browser reload persistence.
5. Mobile-width basic navigation.

The WSL Tailscale node may refuse a connection to its own Serve address even while
another tailnet node can reach it. This PC therefore treats the Windows host as the
independent client and runs `ops/home/qa/tailscale-windows-smoke.ps1`; the script
checks HTTPS plus two independent WSS upgrades without logging the private origin.
The Linux Playwright smoke keeps URL-bearing transport errors redacted.

## Short and long soak

`ops/home/scripts/soak.sh` checks health and restart counts without generating
model calls. The default is 12 minutes. Any restart-count increase fails the run.

```bash
ops/home/scripts/soak.sh
```

Do not busy-wait a Goal for 24 or 72 hours. For those intervals, record start/end
timestamps, maximum log size, restart counts, health failures, Docker/Windows
sleep events, and whether persistence survived. Use the mock model for repeated UI
exercise; real inference requires a separate call budget.

## Safe stop

```bash
docker compose --env-file ops/home/.env -f ops/home/compose.yaml stop
```

Docker init is configured to forward stop signals to the whole Node/pnpm/Wrangler
process group. A normal stop should finish within the configured 30-second grace
period rather than exit 137. Treat another forced kill as a failed graceful-stop
test and inspect it before taking a backup. Never append `-v` to `down` or delete
the `.wrangler` volume during ordinary operations.
