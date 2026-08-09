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

For the independent Tailscale client, invoke
`ops/home/qa/tailscale-windows-smoke.ps1` from WSL as documented in
`ops/home/README.md`. It withholds the origin and checks HTTPS plus two WSS
connections. `tailscale-smoke.mjs` is the browser-level check for a Linux client;
transport exceptions are deliberately sanitized before they reach output.

## No-cost model compatibility

Start the mock override as a separate Compose project on host ports 18878, 14002,
and 14100, as documented in `ops/home/README.md`. Compose `!override` pins the mock
application ports and fixed isolated volume names, so omitted port variables cannot
select the live ports or state. All three ports are loopback-only.
`verify-litellm-bridge.mjs` must prove:

- authenticated `/v1/models` lists only `deepseek-v4-flash`;
- a Responses API text request reaches Chat Completions and returns text;
- a Responses API function definition becomes a Chat Completions tool call;
- the provider payload contains no unsupported `tool_choice`;
- the tool-call assistant content is non-null;
- the exact DeepSeek reasoning context is replayed with the assistant tool call;
- a `function_call_output` completes the round trip;
- exactly three provider requests complete the successful flow;
- one deliberate unsupported `tool_choice` request produces exactly one provider
  rejection and no retry.

`verify-litellm-agent-bridge.mjs` additionally proves four sequential function
calls plus final text across five streaming Responses turns. The full
`verify-inapp-mock.mjs` browser flow proves those calls become Cloudflare OS
`createGadget`, two `writeFile` operations, and `executeCode`; the resulting Gadget
renders `2 + 2 = 4`, survives reload, and survives a Cloudflare OS container
restart without another provider request. This is full application integration
evidence, not evidence that the real model chose and executed the tools.

## Runtime acceptance matrix

| Property | Required evidence | Paid inference? |
| --- | --- | --- |
| Service health | Compose health plus HTTP response | No |
| Host exposure | `ss`/Docker publishes show only loopback | No |
| Owner login | successful local login, redacted | No |
| Model registration | `deepseek-v4-flash`, service URL, no fallback | No |
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
| Final image | Current rebuilt manifest `sha256:fe0b6c57b6ab9bbb6b9c00aa5d1cd562a756453a051d6cd0c6c72b6246e5db0b`, 404,136,718 bytes; Docker reused the previously verified application COPY/build layers |
| Toolchain in image | Node 22.14.0, pnpm 11.17.0, Wrangler 4.119.0 |
| Symlinks | Exact 23 paths/targets pass on host, at build time, and in final image |
| Secret scan | Pass over 855 tracked/untracked non-ignored candidate files |
| LiteLLM mock bridge | Catalog, text, function call, reasoning replay/function output, and exact dispatch-count assertions pass |
| Main runtime | HTTP 200; Cloudflare OS and LiteLLM healthy; host ports 8877/4001 loopback-only |
| Gatekeeper URL | Runtime logs show MCP and other Gatekeepers derived from `http://127.0.0.1:8877` |
| Volume init | First EACCES exposed fresh-volume ownership; one-shot CHOWN-only init fixed it while the application stays UID 1000 |
| Crash recovery | Internal main-process SIGKILL produced restart count 1 under `unless-stopped`; sentinel checksum survived |
| Backup | Fresh clean-stop archive `/home/gpdmini/cloudflare-os-private-backups/20260808T145211Z`; owner-only files and both checksums pass (pre-commit/dirty metadata is explicit) |
| Restore safety | First failed new volume retained; corrected extraction succeeded into a second new volume without touching live state |
| Restore hardening | Launcher rejects the live volume and the pre-marker second volume; completed r3 and latest r4 volumes are retained without touching live state |
| Restore runtime | Latest r4 uses the final image and exact named volume; HTTP 200, completion marker, matching sentinel SHA-256, desktop/mobile browser smoke, then clean stop in 2 seconds |
| Browser layout | Playwright/Linux Chromium passes at 1440x900 and 390x844 with no horizontal overflow; owner-only screenshots are Git-ignored |
| Signup control audit | One owner state exists and the 2026-08-09 unauthenticated `/signup` browser probe reports registration closed, including after the real-stack recreate |
| Current-image soak | 600 seconds pass on image `sha256:fe0b…e5db0b`; both service health states, restart counts, and container IDs remained unchanged, with no inference request |
| Graceful stop | Initial restore stop reached the 30-second limit/exit 137; process-group forwarding then stopped in 1 second without a forced kill, followed by healthy restart, matching sentinel, and a 60-second strict soak |
| Backup stop guard | Backup refuses exit 137/OOM before reading state; the clean-stop path created and checksummed the latest archive, restarted main healthy, and restored it into new r4 |
| Tailscale private route | After explicit approval, one HTTPS 443 root route proxies to `127.0.0.1:8877`; Funnel count is zero; the Windows tailnet client returns HTTP 200 and completes two independent WSS connections, including after the owner-state backup/recreate |
| GitHub fork/push | After explicit owner approval, `oudouusa/cloudflare-os` is verified as a fork of `cloudflare/cloudflare-os`; `main` and `home` were pushed without force or PR creation |
| Real-env preflight | File mode 600, non-placeholder OpenCode/LiteLLM keys, exact OpenCode endpoint, and derived Tailscale origin all pass without disclosure |
| Initial real OpenCode bridge | The first owner-approved GLM-5.2 pilot returned HTTP 200/text and one validated required function call. The owner then selected DeepSeek V4 Flash; this historical GLM result does not prove the replacement route. |
| DeepSeek mock bridge | The one-route catalog, normal Responses conversion, unforced function call, exact reasoning replay, non-null assistant content, and function-output round trip all pass without contacting OpenCode. The successful flow made exactly three provider dispatches; a separate unsupported `tool_choice` probe made one rejected dispatch with no retry. A separate five-turn streaming suite passes `createGadget`, two `writeFile` calls, `executeCode`, and final text with no compatibility failures. |
| Isolated full-app mock | On 2026-08-09 the official Cloudflare OS UI completed normal streaming plus a four-tool agent flow. Browser evidence proves `server.js`/`client.js` writes, actual `executeCode`, rendered `2 + 2 = 4`, accepted changes, reload persistence, and mobile width. The iterative runs made 18 mock dispatches with zero compatibility failures; the final clean run itself used exactly six. After restarting only the same Cloudflare OS container, login, history, tool rows, and rendered Gadget passed with the provider count unchanged. Retained state volume: `cloudflare-os-inapp-mock-wrangler`. No OpenCode request was made. |
| Mock isolation guard | A diagnostic restart command omitted the mock port/volume variables and selected the base names. Port 4001 was already occupied, so the mistakenly configured Cloudflare OS never started; the live stack remained healthy/HTTP 200 and no volume was deleted. The mock overlay now uses `!override` ports plus fixed isolated volume names, and resolved config proves 18878/14002 plus `cloudflare-os-inapp-mock-*` with no manual overrides. |
| DeepSeek real bridge | The initial LiteLLM and direct requests returned 403; the later provider message identified a required opt-in for the China-hosted latest model. After the owner enabled it, a no-retry 16-token probe returned HTTP 200 but stopped during reasoning. One separately approved no-retry 128-token probe then returned HTTP 200/`completed`: a completed `reasoning` item used 11 reasoning tokens and the separate completed `message` item was exactly `OK` (95 input, 13 output tokens total). Provider admission and the direct LiteLLM semantic short-response bridge pass; in-app chat remains untested. |
| DeepSeek real tool preflight | One bounded diagnostic forced `tool_choice: required` and returned HTTP 400 because DeepSeek V4 thinking mode rejects that parameter. No retry/fallback followed. The strict mock now covers the corrected no-`tool_choice` payload plus required reasoning replay; a second real tool call remains unexecuted. |
| Live compatibility deployment | LiteLLM alone was recreated with the DeepSeek adapter and read-only compatibility callback. On 2026-08-09 it was recreated again after the multi-turn reasoning reset fix; runtime source inspection proves the new reset paths are loaded. It returned healthy, exposed only `deepseek-v4-flash`, and remained bound to `127.0.0.1:4001`; Cloudflare OS kept the same container ID and healthy state on `127.0.0.1:8877`. No inference was made. |
| Post-compatibility soak | The earlier 720-second run and a new 600-second run after loading the multi-turn callback both kept container IDs unchanged, both services healthy, and restart counts unchanged. No inference was made. |
| OpenCode Go admission check | Windows-side OpenCode CLI remains excluded. The owner used the OpenCode web workspace setting for China-hosted model consent; no local CLI credential or model catalog was used. |
| User model state | Owner-authorized migration through the application's `UserDurableObject` API replaced the sole `glm-5.2` record with the sole `deepseek-v4-flash` record, set preferred to DeepSeek, and cleared Quick model. A post-restart backup audit independently decoded preferred as `deepseek-v4-flash` and Quick as null without reading or printing the model credential. No inference was made. |
| Model migration backups | Clean pre-migration rollback archive `/home/gpdmini/cloudflare-os-private-backups/20260808T220606Z` and post-migration archive `20260808T222719Z` both pass their recorded checksums. |
| Owner-state backup | Clean committed `home` SHA `3e63fef…`, exact live volume, owner-only permissions, and both checksums pass for `/home/gpdmini/cloudflare-os-private-backups/20260808T213024Z` |
| Owner-state restore | New retained volume `cloudflare-os-home-restore-20260808t213024z-owner` starts healthy on loopback port 18877; closed signup and desktop/mobile browser checks pass; live and restored state each contain one User DO, the same single model key, and two session records without reading values |
| ASB OAuth preflight | Production `/mcp` returns the protected-resource challenge; same-origin OAuth discovery, dynamic registration metadata, and PKCE S256 pass; the Cloudflare OS container reaches the same 401 boundary without a credential |
| Final 2026-08-09 static rerun | Symlink, one-route/no-fallback config, secret, private-env, shell/Node/Python syntax, base/mock Compose, and diff checks pass. Official `pnpm lint`, `pnpm build`, and `pnpm test` pass; lint/build emit only the same upstream warnings and all executed workspace tests pass with documented skips. |

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

The 2026-08-09 DeepSeek mock repeat initially sent its catalog check to the
script's default live diagnostic port because the optional QA base URL was supplied
under an unsupported environment name. It returned HTTP 400 before any inference.
The script now accepts `QA_LITELLM_BASE_URL`; the isolated-port rerun passed the
strict suite and the temporary project was removed without touching live volumes.

Not yet accepted: a complete **real-model** DeepSeek in-app normal response and
real-model-selected Gadget tool execution, authenticated remote browser
reload/reconnect after restart, a live-owner chat/Gadget backup/restore, and ASB
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
| 4 | Real owner-selected OpenCode Go normal and agent tool flow | Partial | Historical GLM proof, strict bridge suites, and the isolated full Cloudflare OS mock all pass; the latter proves normal streaming, actual Cloudflare OS tool execution, file artifacts, test output, rendered Gadget, and restart persistence. After owner opt-in, the real DeepSeek LiteLLM bridge returns a completed final `OK`; the separate reasoning item must not be treated as final answer text. The same in-app flow with the real model remains pending. |
| 5 | No fallback and Use balance OFF | Proven | Static/runtime one-route proof passes; owner confirmed Use balance OFF on 2026-08-09 and the private ledger records no billing identifier |
| 6 | Loopback-only host binds | Proven | Docker publishes and `ss` show only 127.0.0.1 on all active diagnostic/application ports |
| 7 | Tailnet-only Tailscale path | Partial | Approved Serve has one private HTTPS root route, zero Funnel ports, and Windows-client HTTP/WSS proof before and after app recreate; authenticated chat reload and state-continuity proof remain missing |
| 8 | `.wrangler` restart persistence | Proven | Known sentinel SHA survives crash recovery, graceful stop, recreate, and restart |
| 9 | New-volume restore of real data | Partial | Safe new-volume restore now proves the real owner DO/model/session-key shape plus closed-signup and browser runtime. No chat or Gadget exists yet, so their required restore proof remains pending; the verification volume is retained and its containers are stopped. |
| 10 | ASB read-only Gatekeeper search | Partial | Production discovery and container reachability pass. Source inspection proves a read grant registers only three read tools and marks `memory_search` read-only. Owner OAuth consent, a named-tool-only Cloudflare OS grant, and actual Gatekeeper `memory_search` evidence remain missing. |
| 11 | lint/build/test/Compose/Docker/secret suite | Proven | Current ledger results plus final static rerun |
| 12 | Early Access development-pilot wording | Proven | README, architecture, operations, and security documents explicitly reject production wording |
| 13 | Approved first fork/push | Proven | Owner explicitly approved; verified fork has exact `main`/`home` heads and no PR, release, force-push, or upstream write was made |
