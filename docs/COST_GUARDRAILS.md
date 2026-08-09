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

On 2026-08-09 the initial LiteLLM and direct OpenCode requests returned HTTP 403.
The later unredacted provider error identified the exact boundary: the latest
DeepSeek V4 Flash deployment is hosted in China and requires explicit workspace
opt-in. The owner enabled that setting in the OpenCode web console while keeping
**Use balance** OFF.

After the normal one-model/no-retry preflight, the first bounded LiteLLM Responses
request (`max_output_tokens: 16`) returned HTTP 200 from `deepseek-v4-flash` but
spent its allowance on a reasoning preamble before reaching the requested answer.
The owner then approved exactly one additional request with
`max_output_tokens: 128`. That request returned HTTP 200 with response status
`completed`, 95 input tokens, and 13 output tokens. Its Responses payload kept an
11-token reasoning preamble in a completed `reasoning` item and returned exactly
`OK` in the separate completed `message` item. This resolves provider admission
and proves a semantic short response through the direct LiteLLM bridge. Consumers
must judge or display the final `message` item rather than naively concatenating
reasoning and message text. Neither request was retried and no fallback was used.

The first separately bounded real tool probe then returned HTTP 400 before a tool
call because the diagnostic request forced `tool_choice: required`; DeepSeek V4
thinking mode does not support that parameter. No retry or fallback followed that
failure. Cloudflare OS's normal pi-ai path does not force `tool_choice`, so the
diagnostic was corrected rather than weakening explicit tool-choice semantics.
No second real tool probe is authorized by that failed call.

The no-cost regression mock now rejects `tool_choice`, missing or changed
`reasoning_content`, and null assistant tool-call content. The route also uses
LiteLLM's `deepseek/` adapter: unlike the generic `openai/` adapter observed during
diagnosis, it made a single upstream dispatch on the failing mock request. The
request-local compatibility callback neither logs nor persists reasoning text.

OpenCode's current documentation lists DeepSeek V4 Flash as not used for training,
with zero-day retention and a ZDR agreement valid through 2026-08-31. The runtime
admission response is the more specific authority for processing region: inference
content is processed by the China-hosted deployment after the owner's opt-in.
Before another real request, define one explicit call count and an output allowance
large enough for the model's reasoning. The completed direct bridge probe does not
authorize the still-pending in-app chat or tool-flow calls. Never paste the key into
a chat, issue, command argument, or evidence file.

The Windows-side OpenCode CLI is explicitly outside this pilot. Do not use it for
authentication, entitlement checks, model discovery, or QA. If a future account
or model-access failure cannot be resolved through the OpenCode Go web controls,
stop and use the provider's official support path rather than connecting the
Windows CLI as a workaround.

## Stop conditions

Stop real calls if Use balance cannot be confirmed OFF, the account UI differs from
the documented behavior, `/v1/models` exposes more than one route, a request retries,
or usage counters behave unexpectedly. Do not “test again” until logs and source
identify a reason. Slides, whiteboards, multi-account collaboration, and soak tests
that generate inference require a separate call budget and explicit approval.
