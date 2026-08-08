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
4. Confirm LiteLLM `/v1/models` exposes only `glm-5.2`.
5. Confirm the intended test count. MVP permits one short normal response and one
   minimal agentic/tool flow, followed only by evidence-preserving diagnostics.

OpenCode's documentation observed on 2026-08-08 says Go uses model ID `glm-5.2`,
the Chat Completions endpoint is under `https://opencode.ai/zen/go/v1`, and enabling
Use balance allows over-limit requests to consume Zen balance. Those facts must be
rechecked when provider behavior or account UI changes.

Authoritative preflight source: [OpenCode Go documentation](https://opencode.ai/docs/go/).

## Enforced configuration

- `OPENCODE_GO_API_KEY` is the provider credential.
- `LITELLM_MASTER_KEY` protects the local proxy.
- One `glm-5.2` route; no automatic fallback of any kind.
- No OpenAI API key and no alternate paid provider.
- `max_parallel_requests: 1`.
- Model and global retry count `0`.
- No permanent request/response body logging, spend logging, or telemetry.
- API failures are returned to Cloudflare OS; they do not select another provider.

The mock stack validates Responses/Chat conversion and tools without contacting
OpenCode. Prefer it for configuration, backup, restore, UI, restart, and repeated
regression tests.

## Stop conditions

Stop real calls if Use balance cannot be confirmed OFF, the account UI differs from
the documented behavior, `/v1/models` exposes more than one route, a request retries,
or usage counters behave unexpectedly. Do not “test again” until logs and source
identify a reason. Slides, whiteboards, multi-account collaboration, and soak tests
that generate inference require a separate call budget and explicit approval.
