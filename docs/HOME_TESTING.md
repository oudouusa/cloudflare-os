# Home pilot testing

## Baseline at official source

Baseline source: `1cb5e3d9096589e38f3fcfaf3f2191aa95a4c592` on 2026-08-08.

| Check | Result before home changes |
| --- | --- |
| `pnpm install --frozen-lockfile` | Pass with pnpm 11.17.0 |
| `pnpm lint` | Pass; upstream warnings, zero errors |
| `pnpm build` | Pass; expected Vite chunk-size warnings |
| `pnpm test` | Pass; all executed tests passed, documented skips/harness logs only |
| `pnpm run-local` | HTTP 200 at `127.0.0.1:8787`; only loopback listener |
| symlinks | Exactly 23 Git symlinks; every target resolves |
| provider implementation | `Other OpenAI` uses `openai-responses` |
| toolchain | official CI Node 22.14.0, package pnpm 11.17.0, Wrangler 4.119.0 |

The interrupted `run-local` shell exits nonzero after Ctrl-C; that is shutdown
behavior, not a baseline application failure.

## Static home suite

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm test
ops/home/qa/check-symlinks.sh
ops/home/qa/check-config.sh
node ops/home/qa/check-secrets.mjs
node ops/home/qa/check-private-env.mjs
bash -n ops/home/qa/*.sh ops/home/scripts/*.sh
node --check ops/home/qa/*.mjs
docker compose --env-file ops/home/.env -f ops/home/compose.yaml config --quiet
docker compose --env-file ops/home/.env -f ops/home/compose.yaml build cloudflare-os
```

Also mount the host QA directory read-only and run
`/qa/check-symlinks.sh /workspace` against the built image. The image build has an
independent count/resolution assertion. `docs/` and `ops/` are intentionally absent
from the runtime image, so operational documentation edits do not invalidate the
application dependency/build layer.

For the browser-width smoke, install the exact Playwright lock from a detached
`cloudflare-os-home` reference checkout rather than adding a second package manager
lock to the official fork. Set the path explicitly; do not depend on a temporary
directory name:

```bash
(cd /absolute/path/to/cloudflare-os-home/qa && npm ci && npx playwright install chromium)
CFOS_PLAYWRIGHT_ROOT=/absolute/path/to/cloudflare-os-home/qa \
  node ops/home/qa/browser-smoke.mjs
CFOS_PLAYWRIGHT_ROOT=/absolute/path/to/cloudflare-os-home/qa \
  node ops/home/qa/check-signup-closed.mjs
```

The current evidence used reference SHA
`b489556a7215d93fcd61af153222ca89b4e4a80d`, whose lock selected Playwright
1.62.1. `CFOS_BROWSER_EXECUTABLE` may select another Chromium-family binary, but
the WSL test should normally use Playwright's Linux browser. Windows Chrome cannot
provide Playwright's Linux pipe file descriptors across the WSL boundary.

## No-cost model compatibility

Start the mock override as documented in `ops/home/README.md`, then run
`verify-litellm-bridge.mjs`. It must prove:

- authenticated `/v1/models` lists only `glm-5.2`;
- a Responses API text request reaches Chat Completions and returns text;
- a Responses API function definition becomes a Chat Completions tool call;
- a `function_call_output` completes the round trip.

This is compatibility evidence, not evidence that the real model chose and executed
a Cloudflare OS agent tool.

## Runtime acceptance matrix

| Property | Required evidence | Paid inference? |
| --- | --- | --- |
| Service health | Compose health plus HTTP response | No |
| Host exposure | `ss`/Docker publishes show only loopback | No |
| Owner login | successful local login, redacted | No |
| Model registration | `glm-5.2`, service URL, no fallback | No |
| Normal chat | one short real response | Yes, after cost gate |
| Reload persistence | same chat after browser reload | No additional call |
| Restart persistence | account/chat/Gadget after container restart | No additional call |
| Mobile width | basic navigation at a mobile viewport | No |
| Minimal Gadget | Gadget opens and persists | Prefer mock until real agent test |
| Agentic execution | model tool call, resulting file, and actual test output | Yes, once |
| Backup/restore | checksum, new volume, owner/chat/Gadget present | No |
| Tailscale HTTP | tailnet-only HTTPS load | No |
| Tailscale WebSocket | live update plus reconnect | Avoid extra calls where possible |
| Tailscale reload | persistent state after remote reload | No additional call |
| ASB search | Gatekeeper tool invocation, `memory_search`, read-only grant | No model retry loop |
| Restart policy | automatic recovery and unchanged volume | No |
| Short soak | 10–15 minutes healthy, no restart increment | No |

Chat text alone does not prove a tool ran. Agentic acceptance needs the tool name or
structured event, a changed artifact, and a test result that reads that artifact.

## Evidence rules

Write raw screenshots/log summaries to ignored `ops/home/evidence/`. Maintain a
small local index with timestamp, test ID, source SHA, image ID, expected result,
actual result, and redacted artifact path. Never capture API keys, account email,
tailnet name, ASB search text, or provider request bodies.

Tailscale WebSocket, reconnect, and reload persistence are three separate tests.
Likewise, localhost reload and container restart persistence are separate. A single
ordinary chat screenshot cannot satisfy tool execution.

Slides, collaborative whiteboard, cross-account sharing, and repeated long agent
flows are advanced QA. They are excluded from MVP and require an explicit budget
and approval because the reference encountered retries, tool errors, interrupted
responses, auto-repair loops, and share-revoke problems.

## Implementation verification ledger: 2026-08-08

Completed against official base
`1cb5e3d9096589e38f3fcfaf3f2191aa95a4c592`:

| Check | Evidence/result |
| --- | --- |
| Core helper tests | 12/12 pass, including Gatekeeper public URL derivation |
| `pnpm lint` | Pass; only the same upstream warnings observed at baseline |
| `pnpm build` | Pass |
| `pnpm test` | Pass; all executed workspace tests pass and expected integration skips remain |
| Compose | Base, mock, and restore overlays all pass `config --quiet` |
| Final image | `sha256:4bba919844801da219664e086c4b072c0a59508c80ff4826190fbb9c22616752`, 404,136,718 bytes |
| Toolchain in image | Node 22.14.0, pnpm 11.17.0, Wrangler 4.119.0 |
| Symlinks | Exact 23 paths/targets pass on host, at build time, and in final image |
| Secret scan | Pass over 852 tracked/untracked non-ignored candidate files |
| LiteLLM mock bridge | All four model catalog, text, function call, and function output assertions pass |
| Main runtime | HTTP 200; Cloudflare OS and LiteLLM healthy; host ports 8877/4001 loopback-only |
| Gatekeeper URL | Runtime logs show MCP and other Gatekeepers derived from `http://127.0.0.1:8877` |
| Volume init | First EACCES exposed fresh-volume ownership; one-shot CHOWN-only init fixed it while the application stays UID 1000 |
| Crash recovery | Internal main-process SIGKILL produced restart count 1 under `unless-stopped`; sentinel checksum survived |
| Backup | Fresh clean-stop archive `/home/gpdmini/cloudflare-os-private-backups/20260808T145211Z`; owner-only files and both checksums pass (pre-commit/dirty metadata is explicit) |
| Restore safety | First failed new volume retained; corrected extraction succeeded into a second new volume without touching live state |
| Restore hardening | Launcher rejects the live volume and the pre-marker second volume; completed r3 and latest r4 volumes are retained without touching live state |
| Restore runtime | Latest r4 uses the final image and exact named volume; HTTP 200, completion marker, matching sentinel SHA-256, desktop/mobile browser smoke, then clean stop in 2 seconds |
| Browser layout | Playwright/Linux Chromium passes at 1440x900 and 390x844 with no horizontal overflow; owner-only screenshots are Git-ignored |
| Signup control audit | Source enforcement exists, but the 2026-08-09 unauthenticated `/signup` probe still reports registration open; runtime closure is not accepted |
| Final-image soak | 600 seconds pass on image `sha256:4bba…6752`; both service health states, restart counts, and container IDs remained unchanged |
| Graceful stop | Initial restore stop reached the 30-second limit/exit 137; process-group forwarding then stopped in 1 second without a forced kill, followed by healthy restart, matching sentinel, and a 60-second strict soak |
| Backup stop guard | Backup refuses exit 137/OOM before reading state; the clean-stop path created and checksummed the latest archive, restarted main healthy, and restored it into new r4 |
| Tailscale preflight | Read-only Serve status is empty; no configuration was changed |
| GitHub fork/push | After explicit owner approval, `oudouusa/cloudflare-os` is verified as a fork of `cloudflare/cloudflare-os`; `main` and `home` were pushed without force or PR creation |
| Real-env preflight | File mode is 600 and OpenCode key/base pass without disclosure; LiteLLM master key strength and Tailscale public-origin match currently fail, so real Compose/Serve remain blocked |

The first bridge attempt was made while LiteLLM health was still `starting` and
reset its connection; the same test passed once healthy. The first restore attempt
correctly failed rather than overwriting anything because the extraction helper
was non-root on a fresh Docker-owned volume. A second restore proved extraction;
the third proved the completion-marker guard, and the latest r4 repeated the full
clean-stop backup/new-volume/start/browser/stop path. The initial
720-second soak run kept both services healthy with zero restarts, but its final
assertion exited 127 because an associative-array key containing `cloudflare-os`
was evaluated unsafely by Bash. That run is invalid acceptance evidence. The QA
script now uses explicit service branches, also rejects container replacement,
and completed a clean 600-second final-image run. These failures and their distinct
fixes are retained as operational regression cases.

Not yet accepted: closed signup runtime, real owner/chat/Gadget data, real OpenCode
Go normal and agentic calls, Tailscale Serve/HTTP/WebSocket/reload, and ASB
`memory_search` through Gatekeeper.
The Goal remains incomplete until these are evidenced.

## Goal acceptance audit

`Proven` means current direct evidence covers the full condition. `Partial` and
`Pending` are deliberately not treated as completion.

| # | Condition | Status | Authoritative evidence or missing proof |
| --- | --- | --- | --- |
| 1 | Official source and 23 symlinks | Proven | Git ancestry plus exact host/build/image path-target checks |
| 2 | `main`/`home` separation and sync procedure | Proven | `main` remains at/tracks `upstream/main`; committed `home` tracks `origin/home`; documented sync avoids history rewriting |
| 3 | Complete home-reference classification | Proven | `home-reference-audit.md` covers every required file group and evidence family |
| 4 | Real GLM-5.2 normal and agent tool flow | Pending | Mock conversion/tool round-trip passes; real provider and Cloudflare OS agent execution are intentionally uncalled |
| 5 | No fallback and Use balance OFF | Proven | Static/runtime one-route proof passes; owner confirmed Use balance OFF on 2026-08-09 and the private ledger records no billing identifier |
| 6 | Loopback-only host binds | Proven | Docker publishes and `ss` show only 127.0.0.1 on all active diagnostic/application ports |
| 7 | Tailnet-only Tailscale path | Pending | Existing Serve state was read as empty; mutation and remote HTTP/WebSocket/reload tests need approval |
| 8 | `.wrangler` restart persistence | Proven | Known sentinel SHA survives crash recovery, graceful stop, recreate, and restart |
| 9 | New-volume restore of real data | Partial | Multiple safe new-volume restores and matching sentinel pass; owner account/chat/Gadget do not exist yet |
| 10 | ASB read-only Gatekeeper search | Pending | HTTPS endpoint requires auth as expected; Gatekeeper OAuth/grant and `memory_search` tool evidence are missing |
| 11 | lint/build/test/Compose/Docker/secret suite | Proven | Current ledger results plus final static rerun |
| 12 | Early Access development-pilot wording | Proven | README, architecture, operations, and security documents explicitly reject production wording |
| 13 | Approved first fork/push | Proven | Owner explicitly approved; verified fork has exact `main`/`home` heads and no PR, release, force-push, or upstream write was made |
