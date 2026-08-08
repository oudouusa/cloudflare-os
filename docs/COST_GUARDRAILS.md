# Cost guardrails

The goal is to make accidental pay-as-you-go fallback structurally unlikely. No
software-side control can replace the OpenCode account switch, so the first real
inference is blocked until the owner visually confirms **Use balance is OFF**.

## Required preflight before every real QA session

1. Open the OpenCode Go billing/settings page and confirm the current subscription
   is active and **Use balance** is OFF.
2. Record only `confirmed by owner`, the timestamp, and the plan name in the local
   QA ledger. Do not screenshot billing identifiers.
3. Run `ops/home/qa/check-config.sh` and confirm one model route.
4. Confirm LiteLLM `/v1/models` exposes only `deepseek-v4-flash`.
5. Confirm the intended test count. MVP permits one short normal response and one
   minimal agentic/tool flow, followed only by evidence-preserving diagnostics.

OpenCode's documentation rechecked on 2026-08-09 says DeepSeek V4 Flash uses model
ID `deepseek-v4-flash`, the Chat Completions endpoint is under
`https://opencode.ai/zen/go/v1`, and enabling Use balance allows over-limit requests
to consume Zen balance. Its published Go allowance estimate is substantially higher
for this model than for GLM-5.2, which makes it the owner's current choice after the
initial GLM pilot. These facts must be rechecked when provider behavior or account
UI changes.

Authoritative preflight source: [OpenCode Go documentation](https://opencode.ai/docs/go/).

## Enforced configuration

- `OPENCODE_GO_API_KEY` is the provider credential.
- `LITELLM_MASTER_KEY` protects the local proxy.
- One `deepseek-v4-flash` route; no automatic fallback of any kind.
- No OpenAI API key and no alternate paid provider.
- `max_parallel_requests: 1`.
- Model and global retry count `0`.
- No permanent request/response body logging, spend logging, or telemetry.
- API failures are returned to Cloudflare OS; they do not select another provider.

The mock stack validates Responses/Chat conversion and tools without contacting
OpenCode. Prefer it for configuration, backup, restore, UI, restart, and repeated
regression tests.

## Current provider admission state

On 2026-08-09 the single DeepSeek route and all four mock bridge checks passed, but
the first real request through LiteLLM returned HTTP 403. One direct OpenCode Go
Chat Completions request with the same key also returned HTTP 403. The prior GLM-5.2
pilot had succeeded with this account, and the redacted error classification did
not identify insufficient balance, an invalid API key, or a missing model. This is
therefore recorded as an unresolved model-access/provider-permission boundary, not
as a conversion failure. No retry or fallback was attempted after the two distinct
paths failed.

Before any further real request, verify that `opencode-go/deepseek-v4-flash` appears
in the owner's OpenCode model picker and succeeds for one minimal OpenCode prompt,
or replace the Go API key through the private `.env` workflow. Never paste the key
into a chat, issue, command argument, or evidence file.

The Windows OpenCode 1.1.53 client currently has no `OpenCode Go` entry in
`opencode auth list`, and its model catalog consequently has no
`opencode-go/deepseek-v4-flash` entry. This does not prove the standalone API key is
invalid—the same key previously reached GLM—but it means the CLI cannot yet serve
as the independent entitlement check. Follow the official provider flow in the
TUI: `/connect` → **OpenCode Go**, enter the key locally, then use `/models`. This is
a manual secret-handling action; automation must not read or copy the key.

## Stop conditions

Stop real calls if Use balance cannot be confirmed OFF, the account UI differs from
the documented behavior, `/v1/models` exposes more than one route, a request retries,
or usage counters behave unexpectedly. Do not “test again” until logs and source
identify a reason. Slides, whiteboards, multi-account collaboration, and soak tests
that generate inference require a separate call budget and explicit approval.
