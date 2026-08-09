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
docker compose --env-file ops/home/.env -f ops/home/compose.yaml exec -T \
  cloudflare-os sh -lc 'test -s /etc/ssl/certs/ca-certificates.crt && \
    test "$(find /etc/ssl/certs -maxdepth 1 -type l | wc -l)" -gt 0'
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

`check-deepseek-stream-guard.py` must run inside the pinned LiteLLM image after
the callback is imported. It proves empty-choice DeepSeek metadata chunks are
ignored by the converter's output-item, reasoning-end, and text-delta helpers. It
also proves that completed Chat Completions reasoning is emitted as exactly one
Responses `response.output_item.added`/`done` pair when the provider omitted an
initial reasoning delta. The fallback is skipped when LiteLLM already emitted the
reasoning item. The metadata chunk remains available to LiteLLM's stream
accumulator; the normal bridge and five-turn agent suites prove the guards do not
change content-bearing chunks.

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
| iPhone IME | conversion Enter does not send; attached connection capsule remains visible | No |
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

### IME and Mobile Safari regression

`ChatInterface.ime.test.tsx` dispatches composition events against the real React
composer. It proves that the Enter used to confirm an active Japanese IME does not
send, Safari's legacy process-key event (`keyCode === 229`) does not send, and an
ordinary Enter after composition ends sends exactly once. `imeComposition.test.ts`
separately covers native, React-wrapped, Safari-legacy, and ordinary Enter events.

Because jsdom cannot reproduce Mobile Safari's stale selection range, the following
physical-device check is required:

1. Select **No agent** so the check cannot spend model quota.
2. Attach the read-only ASB connection so its capsule appears in the composer.
3. Enter Japanese next to (but not inside) the capsule and press Enter to confirm a
   conversion candidate.
4. Confirm that the message was not sent and that the capsule is still visible.
5. Press an ordinary Enter after composition has ended and confirm exactly one
   no-agent message is added.

Do not capture the ASB search body or account identifiers in evidence. A desktop
IME run is useful for the send guard, but it does not replace the physical-iPhone
capsule check.

On 2026-08-09 the owner completed that check on a physical iPhone: the IME
conversion Enter did not send and the connection capsule remained present.

### iPhone composer focus zoom

The composer keeps its 14px desktop font but uses 16px when both `(hover: none)`
and `(pointer: coarse)` match. A Chromium check against the compiled CSS reports
14px at 1440×900 with a fine pointer and 16px at 390×844 with touch emulation.
The viewport remains `width=device-width, initial-scale=1.0`; the implementation
does not disable user scaling or pinch zoom. The mirror copies the textarea's
computed font metrics, so capsules and ordinary glyphs remain aligned.

On 2026-08-09 the owner confirmed on a physical iPhone that tapping the composer
no longer changes the page scale.

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
| Secret scan | Pass over 860 tracked/untracked non-ignored candidate files after the empty-choices regression check was added |
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
| Isolated full-data restore | The stopped in-app mock volume was archived with valid checksums and restored without overwriting any volume. Restore now selects only durable `./state`, excluding Wrangler build `tmp/`; the first state-only volume passed owner login, the exact saved chat, `createGadget`/two `writeFile`/`executeCode` rows, and an actual iframe render of `2 + 2 = 4`, with zero provider dispatches. A second retained state-only volume independently reproduced the render after an unrelated mock stack was stopped. The final clean archive `/home/gpdmini/cloudflare-os-mock-private-backups/20260809T023821Z` records `home=d476872…`, `worktree_dirty=false`, and `archive_scope=wrangler-state-only-v1`; extraction into retained volume `cloudflare-os-home-restore-20260809t023821z-final` produced the exact source/restored file digest `cc91d0c…a1bbd1`. The older full archive and diagnostic volumes remain retained. |
| Mock isolation guard | A diagnostic restart command omitted the mock port/volume variables and selected the base names. Port 4001 was already occupied, so the mistakenly configured Cloudflare OS never started; the live stack remained healthy/HTTP 200 and no volume was deleted. The mock overlay now uses `!override` ports plus fixed isolated volume names, and resolved config proves 18878/14002 plus `cloudflare-os-inapp-mock-*` with no manual overrides. |
| DeepSeek real bridge | The initial LiteLLM and direct requests returned 403; the later provider message identified a required opt-in for the China-hosted latest model. After the owner enabled it, a no-retry 16-token probe returned HTTP 200 but stopped during reasoning. One separately approved no-retry 128-token probe then returned HTTP 200/`completed`: a completed `reasoning` item used 11 reasoning tokens and the separate completed `message` item was exactly `OK` (95 input, 13 output tokens total). Provider admission and the direct LiteLLM semantic short-response bridge pass; in-app chat remains untested. |
| DeepSeek real tool preflight | One bounded diagnostic forced `tool_choice: required` and returned HTTP 400 because DeepSeek V4 thinking mode rejects that parameter. No retry/fallback followed. The strict mock now covers the corrected no-`tool_choice` payload plus required reasoning replay; a second real tool call remains unexecuted. |
| DeepSeek empty-choices incident | Two owner-initiated in-app streams at 12:02 and 12:03 JST each reached the provider and returned HTTP 200, then LiteLLM 1.95.0 raised `IndexError` because its Responses stream converter indexed `choices[0]` on an empty-choice metadata chunk. They were separate UI actions, not automatic retries. Cloudflare OS surfaced `Error: list index out of range`; no fallback was configured. |
| DeepSeek empty-choices guard | The compatibility module now guards three pinned LiteLLM content helpers only for empty-choice `deepseek-v4-flash` chunks. A runtime check inside the digest-pinned image passes; normal Responses, function round-trip, five-turn streaming agent, and usage-request mock tests pass with zero `IndexError`. |
| Post-guard real stream | LiteLLM alone was recreated healthy while the Cloudflare OS container remained unchanged. One newly approved live streaming Responses request returned HTTP 200/`completed`, one reasoning item, one message exactly `OK`, and 91 input + 15 output = 106 tokens. The LiteLLM log records one POST and no `IndexError`; retry/fallback remained disabled. This proves the live direct stream fix, not a post-fix in-app run. |
| Live compatibility deployment | LiteLLM alone was recreated with the DeepSeek adapter and read-only compatibility callback. On 2026-08-09 it was recreated again after the multi-turn reasoning reset fix; runtime source inspection proves the new reset paths are loaded. It returned healthy, exposed only `deepseek-v4-flash`, and remained bound to `127.0.0.1:4001`; Cloudflare OS kept the same container ID and healthy state on `127.0.0.1:8877`. No inference was made. |
| Post-compatibility soak | The earlier 720-second run and a new 600-second run after loading the multi-turn callback both kept container IDs unchanged, both services healthy, and restart counts unchanged. No inference was made. |
| OpenCode Go admission check | Windows-side OpenCode CLI remains excluded. The owner used the OpenCode web workspace setting for China-hosted model consent; no local CLI credential or model catalog was used. |
| User model state | Owner-authorized migration through the application's `UserDurableObject` API replaced the sole `glm-5.2` record with the sole `deepseek-v4-flash` record, set preferred to DeepSeek, and cleared Quick model. A post-restart backup audit independently decoded preferred as `deepseek-v4-flash` and Quick as null without reading or printing the model credential. No inference was made. |
| Model migration backups | Clean pre-migration rollback archive `/home/gpdmini/cloudflare-os-private-backups/20260808T220606Z` and post-migration archive `20260808T222719Z` both pass their recorded checksums. |
| Owner-state backup | Clean committed `home` SHA `3e63fef…`, exact live volume, owner-only permissions, and both checksums pass for `/home/gpdmini/cloudflare-os-private-backups/20260808T213024Z` |
| Owner-state restore | New retained volume `cloudflare-os-home-restore-20260808t213024z-owner` starts healthy on loopback port 18877; closed signup and desktop/mobile browser checks pass; live and restored state each contain one User DO, the same single model key, and two session records without reading values |
| ASB OAuth preflight | Production `/mcp` returns the protected-resource challenge; same-origin OAuth discovery, dynamic registration metadata, and PKCE S256 pass. The earlier container check used Node fetch, which uses Node's bundled roots and therefore did not prove the separate workerd trust path. |
| ASB workerd TLS incident | The first Gatekeeper connect attempts failed before OAuth with `unable to get local issuer certificate` and HTTP 502. The ASB chain verified on the host, Node fetch returned the expected 401 both on the host and in the container, and host workerd also returned 401. The digest-pinned `node:22.14.0-bookworm-slim` runtime had no Debian trust store. Copying only `ca-certificates.crt` proved insufficient in a workerd probe, so the home Dockerfile copies the bundle, 280 hashed links, and link targets from the matching digest-pinned full Node image and asserts both the bundle and links exist. A disposable post-rebuild workerd 1.20260801.1 probe then reached the ASB `/mcp` boundary and received the expected HTTP 401 with TLS verification enabled. Final image `sha256:9373312…3c5b` was healthy on the preserved live volume. The owner subsequently completed read consent, added the ASB connection, and attached its capsule in the composer; the later runtime acceptance is recorded below. |
| ASB read-only runtime acceptance | On 2026-08-09 the owner attached one ASB capsule and initiated one bounded DeepSeek run. Read-only inspection of the persisted conversation proves its `executeCode` wrapper called `env.MCP_AUTONOMOUS_SECOND_BRAIN.memorySearch({ query: "Cloudflare OS", limit: 1 })` exactly once, called no write/capture method, produced an `approved` observation on the same Gatekeeper, and persisted the final message `検索成功`. The code SHA-256 is `fff47a3e…63558c`; the agent run finished `ok`, and all three Responses stages returned HTTP 200. The current grant is the server's complete OAuth read surface (`3 read-only, 0 requiring approval`), not a named-tool-only fragment. It meets the required read-only-search boundary because the read OAuth grant registers no write/capture tools and the capsule was attached only to the requesting conversation; narrowing it to named `memory_search` remains optional defense-in-depth. No search result body was printed or committed. |
| DeepSeek completed-reasoning fallback | Read-only logs from the successful ASB run revealed repeated provider warnings that older assistant steps lacked `reasoning_content`. LiteLLM's completed response retained the reasoning item, but its streaming converter did not always emit the preceding Responses reasoning `output_item.done` event that Cloudflare OS persists. Compatibility commit `687f593` backfills one added/done pair from the completed response only when no normal reasoning event was emitted. The isolated mock five-turn agent suite now asserts exactly one pair for every completed reasoning item; the direct guard covers duplicate suppression. Config, symlink, secret, Python/Node syntax, lint, full workspace test, build, and isolated bridge/agent suites pass. LiteLLM alone was recreated healthy on the live stack; Cloudflare OS retained container `4ef735c8…f3e5de` and volume `cloudflare-os-home-wrangler`, and both ports remain loopback-only. A 600-second post-deployment soak kept both container IDs, healthy states, and restart counts unchanged. The later fresh real-model normal conversation persisted reasoning and produced no missing-`reasoning_content` warning, as recorded in the next row. |
| DeepSeek live normal-chat index collision | On 2026-08-09 the owner sent one short in-app normal prompt after the completed-reasoning fallback deployment. Exactly one `/v1/responses` request returned HTTP 200, `agent.run` finished `ok` in 5.5 seconds, and no missing-reasoning, `IndexError`, retry, or fallback log appeared. The persisted assistant model data contained one 175-character thinking block but two identical 53-character text blocks; the rendered transcript consequently showed the final answer twice. The fallback had reused `output_index=0`, replacing pi-ai's active message slot before LiteLLM emitted the message done event. Commit `1ce5b2a` now reserves `_next_tool_output_index` for late reasoning and advances it, so message, tool, and reasoning items cannot collide. A role-first mock reproduces the provider ordering; the exact production pi-ai parser now yields one thinking block and one final text block, while the six-request late-reasoning plus five-turn agent suite, config/symlink/secret/syntax checks, lint, build, and all workspace tests pass. Two full isolated-browser attempts were invalidated by documented Wrangler development-stack `ERR_EMPTY_RESPONSE` asset failures and are not counted as compatibility evidence. LiteLLM alone was recreated healthy with the fix; Cloudflare OS retained container `4ef735c8…f3e5de` and `cloudflare-os-home-wrangler`. The owner's post-fix fresh conversation then finished one `agent.run` with two HTTP-200 Responses stages and no missing-reasoning, `IndexError`, retry, or fallback log. Read-only durable-state inspection found exactly one user row followed by exactly one assistant row containing one 8-character final message (`sha256 edb18ebb53e9…`) and one 126-character reasoning value (`sha256 9018b6062bd0…`); the owner confirmed that the UI rendered the final only once. This closes the normal-chat regression. |
| DeepSeek live Gadget agent acceptance | On 2026-08-09 the owner initiated one fresh DeepSeek V4 Flash Gadget run and confirmed the final `Gadgetテスト成功`. The single `agent.run` finished `ok` in 18.2 seconds; five sequential Responses stages returned HTTP 200 with no missing-reasoning, `IndexError`, retry, or fallback log. Read-only durable-state inspection proves exactly one `createGadget`, two `writeFile`, and one `executeCode` call. The writes targeted `server.js` (`135` characters, `sha256 f22bdfbfec6c…`) and `client.js` (`114` characters, `sha256 98271b4ef271…`); decoding the accepted Yjs V2 update produced those two files under the created Gadget root with exactly matching hashes. The server exports the required named `Gadget` class with an `add(a, b)` method that returns `a + b`; the client calls `add(2, 3)` and writes the result into the document. Most importantly, `executeCode` awaited the created `env.MINIMAL_ADD_GADGET.add(2, 3)` binding rather than redefining a test-only function, branched on equality with `5`, and persisted the 42-character successful output (`sha256 44e175929aac…`); the live Worker log independently contains the result `5` and `TEST PASSED`. All four persisted model turns identify only `deepseek-v4-flash`, the final stored message is exactly one `Gadgetテスト成功`, and both services remained healthy without container replacement. This is the required real-model-selected file/tool/test proof. |
| Final post-Gadget acceptance rerun | On current `home` code, exact 23-symlink, one-route/no-fallback/no-retry, 864-file secret, private-env, shell/Node/Python syntax, base/mock Compose, live DeepSeek guard, HTTP health, and loopback-listener checks pass. Official `pnpm lint`, `pnpm build`, and `pnpm test` all exit zero; lint/build show only the baseline warnings and all executed tests pass with the documented skips/harness error-path logs. |
| Optional CLIProxyAPI read-only audit | GreenVPS identity was verified before inspection. CLIProxyAPI v7.2.99 is healthy as a container and publishes 8317 only on the VPS Tailscale address and loopback. From the Cloudflare OS container, unauthenticated `/v1/models` and `/v1/responses` both reached the service and returned 401; no inference occurred. Exact-tag source registers `/v1/responses` and GPT-5.6 models. Authenticated compatibility remains untested because the sole existing key is shared and may not be reused. The VPS was 98% full with about 1.6 GiB free; no cleanup or mutation was performed. |
| Final 2026-08-09 static rerun | Symlink, one-route/no-fallback config, secret, private-env, shell/Node/Python syntax, base/mock Compose, and diff checks pass. Official `pnpm lint`, `pnpm build`, and `pnpm test` pass; lint/build emit only the same upstream warnings and all executed workspace tests pass with documented skips. |
| Post-empty-choices full rerun | The runtime guard check, normal/function/five-turn streaming mock suites, base/mock Compose, symlinks, one-route config, private env, 860-file secret scan, shell/Node/Python syntax, and diff checks pass. Official `pnpm lint`, `pnpm build`, and `pnpm test` pass again; only the documented upstream warnings/skips remain. |
| IME/iPhone known-issue fix | Local contrib branch combines upstream PR #94's deferred capsule bookkeeping with PR #82's composition guard, preserving both source commits through `cherry-pick -x`. Two new files add six regression tests; the real React composer proves active-composition Enter and Safari keyCode 229 do not send, then ordinary Enter sends once. Full `pnpm lint`, `pnpm build`, and `pnpm test` pass with only the documented warnings/skips. Image `sha256:67efc008…04ccc0` is healthy with restart count zero, the same Wrangler volume, loopback-only 8877, and the unchanged healthy LiteLLM container; fresh 1440×900 and 390×844 browser-width smoke tests pass. On 2026-08-09 the owner confirmed on a physical iPhone that conversion Enter did not send and the capsule remained. |
| iPhone composer focus zoom | The compiled and live-served CSS preserves the 14px desktop composer and selects 16px for a touch-first 390×844 browser profile. User scaling remains enabled and the mirrored token layer inherits the same computed font metrics. Full lint/build/test, 126 home frontend tests, desktop/mobile layout smoke, symlink/config/secret/private-env checks, and loopback binds pass. Image `sha256:78700848…62d0a3` is healthy with restart count zero on the preserved Wrangler volume; LiteLLM stayed in the same healthy container. On 2026-08-09 the owner confirmed on a physical iPhone that tapping the composer no longer changes the page scale. |

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

The post-index-fix **real-model** DeepSeek normal response and the separately initiated
real-model Gadget file/tool/test flow are both accepted. Historical conversations that
predate reasoning persistence should still not be reused for future compatibility QA.

## Goal acceptance audit

`Proven` means current direct evidence covers the full condition. `Partial` and
`Pending` are deliberately not treated as completion.

| # | Condition | Status | Authoritative evidence or missing proof |
| --- | --- | --- | --- |
| 1 | Official source and 23 symlinks | Proven | Git ancestry plus exact host/build/image path-target checks |
| 2 | `main`/`home` separation and sync procedure | Proven | `main` remains at/tracks `upstream/main`; committed `home` tracks `origin/home`; documented sync avoids history rewriting |
| 3 | Complete home-reference classification | Proven | `home-reference-audit.md` covers every required file group and evidence family |
| 4 | Real owner-selected OpenCode Go normal and agent tool flow | Proven | DeepSeek V4 Flash normal chat rendered and persisted one final after the index fix. A separate real-model run then selected and completed one `createGadget`, two `writeFile`, and one `executeCode` call; accepted Yjs state contains the two exact files, the test invoked the created Gadget binding's `add(2, 3)`, and both the persisted result and Worker log prove `5`/`TEST PASSED`. All seven Responses stages across the accepted normal and Gadget runs returned HTTP 200 with no compatibility error, retry, or fallback. |
| 5 | No fallback and Use balance OFF | Proven | Static/runtime one-route proof passes; owner confirmed Use balance OFF on 2026-08-09 and the private ledger records no billing identifier |
| 6 | Loopback-only host binds | Proven | Docker publishes and `ss` show only 127.0.0.1 on all active diagnostic/application ports |
| 7 | Tailnet-only Tailscale path | Proven | Approved Serve has one private HTTPS root route and zero Funnel ports. Windows-client HTTP and two independent WSS connections passed before and after app recreate; on 2026-08-09 the owner additionally confirmed login over the Tailscale HTTPS origin, opening an existing chat, and successful browser reload with its state retained. |
| 8 | `.wrangler` restart persistence | Proven | Known sentinel SHA survives crash recovery, graceful stop, recreate, and restart |
| 9 | New-volume restore of real data | Proven | In addition to the owner DO/model/session-key restore, actual isolated Cloudflare OS account, chat, four tool rows, Gadget files, test result, and rendered `2 + 2 = 4` artifact were restored from a checksummed backup into new labeled volumes. The mock provider count stayed zero; source/live volumes were not overwritten or removed. Wrangler 4.119.0 Gadget-preview flakiness under overlapping dev stacks remains an Early Access operations constraint, not missing restore evidence. |
| 10 | ASB read-only Gatekeeper search | Proven | The persisted live conversation proves one bounded `memorySearch` call through the attached ASB Gatekeeper, an approved observation on that same Gatekeeper, no write/capture call, and final `検索成功`; the agent run and all three provider stages completed successfully. The present scope contains all three tools registered by the server's read-only OAuth grant rather than only named `memory_search`, but exposes zero write/capture tools and was attached only to the requesting conversation. |
| 11 | lint/build/test/Compose/Docker/secret suite | Proven | Current ledger results plus final static rerun |
| 12 | Early Access development-pilot wording | Proven | README, architecture, operations, and security documents explicitly reject production wording |
| 13 | Approved first fork/push | Proven | Owner explicitly approved; verified fork has exact `main`/`home` heads and no PR, release, force-push, or upstream write was made |

The optional CLIProxyAPI/Codex direct route is deferred after read-only network,
authentication-boundary, and exact-source compatibility checks. A new dedicated
key, explicit GreenVPS change approval, and bounded authenticated runtime proof are
still required. This optional route does not block the OpenCode Go MVP and must not
be allowed to become its fallback.
