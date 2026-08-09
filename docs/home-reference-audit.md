# cloudflare-os-home reference audit

This audit treats `Sunwood-ai-labs/cloudflare-os-home` as an operations, QA, and
failure catalogue. It does not copy the repository's vendored Cloudflare OS tree
or public evidence assets. The reference was inspected at
`b489556a7215d93fcd61af153222ca89b4e4a80d`; its notice pins the vendored
official source to `0eaec6c5e8fc6b3298ea1aa73bf5c3e47b923c7f`. This fork started from
official Cloudflare OS `1cb5e3d9096589e38f3fcfaf3f2191aa95a4c592`. Both remote main HEADs
were rechecked on 2026-08-09 and remained at the recorded official and reference
SHAs.

The decisions below mean:

- **Adopt**: retain the requirement or technique with no meaningful semantic change.
- **Adapt**: retain the lesson but reshape it for an official-source fork.
- **Reject**: deliberately exclude it from this pilot.
- **Defer**: keep it as a later experiment, outside MVP acceptance.

## Runtime and provider files

| Reference file | Decision | Reason and destination | Verification |
| --- | --- | --- | --- |
| `docker-compose.yml` | Adapt | Reuse localhost publishes, service-name routing, health dependency, named state/cache volumes, and `unless-stopped`. Replace the multi-provider environment and mounts with two narrowly scoped services in `ops/home/compose.yaml`. | `docker compose config --quiet`, port inspection, health status, restart test |
| `Dockerfile` | Adapt | Preserve the containerized `run-local` idea, but use official CI's Node 22.14 line rather than the reference's Node 24, pin the base image digest, and build from this official checkout. | Image build, Node/pnpm versions, in-image symlink audit |
| `.env.example` | Adapt | Keep a documented template, but expose only OpenCode Go, LiteLLM, ports, public origin, image, and volume names. All values that look like secrets are inert placeholders. | Secret scanner and manual diff against Compose interpolation |
| `litellm/Dockerfile` | Reject | A custom LiteLLM build increases patch and supply-chain surface. Use the official LiteLLM `v1.95.0` multi-architecture image pinned by digest. | Inspect resolved image and run bridge QA |
| `litellm/config.yaml` | Adapt | Retain the proxy boundary, but collapse 26 routes to one owner-selected `deepseek-v4-flash` route, use LiteLLM's DeepSeek adapter, and allow one request at a time with no retry, fallback, message/spend logging, or telemetry. Mount an independently authored, async-local compatibility callback because LiteLLM 1.95.0 otherwise drops DeepSeek reasoning on a Responses tool-result turn. | `check-config.sh`, authenticated `/v1/models`, strict normal/tool/reasoning bridge QA |
| `litellm/patch_litellm_mantle.py` | Reject | The Mantle/AWS compatibility patch is unrelated to OpenCode Go and would create a maintained fork of LiteLLM internals. | Assert no Mantle or AWS reference in the home configuration |

The Compose URL from Cloudflare OS must be `http://litellm:4000/v1`; `localhost`
inside the Cloudflare OS container would refer to that container, not LiteLLM.

## Operations scripts

| Reference file | Decision | Reason and destination | Verification |
| --- | --- | --- | --- |
| `scripts/enable-tailscale-serve.ps1` | Adapt | Preserve the Serve-only, no-Funnel pattern. Replace PowerShell mutation with documented WSL-safe inspection/proposal steps. No Serve state is changed without approval. | Capture current Serve JSON, review proposed route, then HTTP/WebSocket/reload QA after approval |
| `scripts/verify-project-litellm.ps1` | Adapt | Reimplement its configuration checks as portable shell/Node QA and add a real Responses-to-Chat tool round-trip. | `check-config.sh` and `verify-litellm-bridge.mjs` |

## QA programs

| Reference file | Decision | Reason and destination | Verification |
| --- | --- | --- | --- |
| `qa/auth-and-home.mjs` | Adapt | Reuse owner creation/login and home-load scenario; keep credentials out of tracked scripts and evidence. | Browser QA on localhost and restored volume |
| `qa/configure-and-chat.mjs` | Adapt | Reuse explicit model configuration and short chat; configure `Other OpenAI` for LiteLLM's service URL. | One real short chat only after cost confirmation |
| `qa/inspect-model-modal.mjs` | Adapt | Reuse as a diagnostic for current model form fields, not a brittle acceptance test. | Manual field inventory before model registration |
| `qa/update-litellm-network-model.mjs` | Reject | It mutates an older broad provider configuration. This pilot has one declarative model and no dynamic fallback route. | Static config assertion |
| `qa/test-config.mjs` | Adapt | Reuse the configuration-smoke intent in `check-config.sh` and Compose validation. | Both scripts pass |
| `qa/retry-chat.mjs` | Reject | Repeated inference conflicts with the zero-retry and cost-guardrail policy. Failures are diagnosed before any intentional rerun. | LiteLLM config shows zero retry; QA ledger records calls |
| `qa/capture.mjs` | Adapt | Keep local evidence capture, but write to ignored `ops/home/evidence/` and redact identity, tailnet, keys, and ASB content. | Secret/redaction review before any evidence is shared |
| `qa/reload-mobile-evidence.mjs` | Adapt | Reuse distinct reload persistence and mobile-width checks. Do not treat one screenshot as proof of both. | Separate evidence entries for reload and mobile width |
| `qa/agentic-gadget-smoke.mjs` | Adapt | Reuse minimal Gadget creation, but require actual file mutation/tool invocation and a test result. | Tool-call record plus resulting file and test output |
| `qa/agentic-wait-and-evidence.mjs` | Adapt | Reuse bounded waiting/evidence capture; add explicit timeout and no automatic paid rerun. | Timeout path and successful tool evidence |
| `qa/evidence-retry-flow.mjs` | Reject | Its retry-oriented flow can consume quota and blur first-failure evidence. | No automated retry in the local QA suite |
| `qa/final-evidence.mjs` | Adapt | Reuse final-state capture only after independent assertions have passed. | Evidence index links assertions to artifacts |
| `qa/package.json` | Adapt | Retain Node-based portable QA without importing the reference dependency tree; `browser-smoke.mjs` can load Playwright from an explicitly selected reference QA checkout. | `node --check` for every local QA script plus pinned reference `npm ci` browser run |
| `qa/package-lock.json` | Reject | It belongs to the reference harness and conflicts with this repository's pnpm-only policy. | No copied npm lockfile |

Ordinary assistant text is not accepted as proof of agent execution. The minimum
agentic evidence is a tool call, the requested state change (for example a file),
and its test output.

## Research, guidance, security, and CI

| Reference file | Decision | Reason and destination | Verification |
| --- | --- | --- | --- |
| `QA.md` | Adapt | Use its staged localhost, persistence, mobile, Tailscale, agent, and advanced scenarios as the basis for `HOME_TESTING.md`. Separate API-expensive scenarios. | Test matrix with one evidence item per property |
| `RESEARCH-LOG.md` | Adopt | Preserve the observed failures as design inputs: service DNS, WebSocket reconnect, interrupted final response with persisted draft, Slides/tool failures, whiteboard repair, and share revoke error. | Each applicable lesson maps to a test or deferred-risk entry |
| `SECURITY.md` | Adapt | Keep localhost-first access and secret hygiene; strengthen it with no-new-privileges, capability drops, owner-only state, signup closure, ASB least privilege, and no public tunnel. | Bind inspection, permission checks, signup audit, secret scan |
| `docs/guide/architecture.md` | Adapt | Reuse the two-service mental model and state boundary in `HOME_ARCHITECTURE.md`; replace vendored-upstream assumptions with a true Git fork. | Architecture-to-Compose review |
| `docs/guide/getting-started.md` | Adapt | Reuse progressive setup, but add Use balance OFF gate and approval boundaries in `ops/home/README.md`. | Fresh-start walkthrough |
| `docs/guide/usage.md` | Adapt | Reuse basic model/chat/Gadget sequence while limiting the default model and call count. | MVP runtime checklist |
| `docs/guide/troubleshooting.md` | Adopt | Reuse failure-first diagnostics for Docker, LiteLLM, Wrangler, and Tailscale; update commands and filenames. | Induce or observe health failure without paid inference |
| `docs/guide/evidence.md` | Adapt | Keep the concept of reproducible proof, but store raw artifacts locally and ignored by Git. | `git status` and secret scan exclude evidence |
| `.github/workflows/ci.yml` | Adapt | Reuse static validation intent locally first. A home-branch workflow can be considered after the initial approved push; no external CI is created now. | Local lint/build/test/Compose/image suite |
| `.github/workflows/pages.yml` | Reject | Publishing a documentation/evidence site expands public exposure and is unrelated to the private pilot. | No Pages workflow or deployment |
| `THIRD-PARTY-NOTICES.md` | Adapt | Record Apache-2.0 provenance only for code actually copied. Current implementation reuses requirements and independently authored code, not source snippets. | License review before commit |

## Evidence and advanced experiments

| Reference evidence | Decision | What it proves or warns about | Local treatment |
| --- | --- | --- | --- |
| `artifacts/screenshots/01`–`17` | Adapt | Login, model setup, short chat, reload, mobile layout, Tailscale access, and a basic agent/Gadget flow can work. | Reproduce locally with redacted, ignored evidence; do not copy images |
| `artifacts/screenshots/18`–`97` | Defer | Slides can consume many calls and showed placeholder output, retries, export/tool problems, and partial/interrupted completion. | Advanced QA only after explicit approval; never loop automatically |
| `artifacts/screenshots/98`–`117` and `gadget-lab/*` | Defer | Whiteboard creation, real test execution, auto-repair, persistence, multi-tab state, conflicts, and security experiments are valuable high-level tests. | Retain as future scenarios after MVP and a call budget |
| `artifacts/screenshots/118`–`138` and multiuser Hyperframes | Defer | Cross-account realtime collaboration worked in parts, while revoke surfaced a UI error. | Do not create extra accounts in MVP; isolate later security QA |
| Hyperframe manifests/renders | Reject | They are publishing assets, not runtime requirements, and copying them would add bulk and attribution obligations. | No copied render or manifest |

## Explicitly rejected vendored source

`upstream/cloudflare-os/` is rejected in full. It contains zero Git symlinks because
the official 23 links were flattened into ordinary files. Copying it would lose
Git ancestry, obscure upstream updates, and violate the official-fork design. This
repository instead retains all 23 official symlinks and validates their exact
paths, targets, and resolvability with `ops/home/qa/check-symlinks.sh` and during
the Docker build.

The only core operational ideas re-evaluated from the reference are
`CFOS_DISABLE_DEV_WATCHERS` and `WRANGLER_DEV_IP`. They were reapplied as small,
tested changes to the current official `run-dev-server.js`, not copied as an old
whole-file patch. A third minimal change derives each Gatekeeper `BASE_URL` from
`PUBLIC_BASE_URL`, which is necessary for MCP OAuth callbacks on port 8877 and a
future approved Tailscale HTTPS origin.
