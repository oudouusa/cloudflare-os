# Home pilot architecture

This is an Early Access development pilot built from the official Cloudflare OS
source. It is not a production `workerd` deployment. “Always on” means it recovers
while Windows, WSL2, Docker Desktop, and Tailscale are running; Windows sleep stops
the stack.

## Trust and traffic boundaries

```text
browser on this PC ── 127.0.0.1:8877 ─┐
                                      ├─> Cloudflare OS / Wrangler / workerd
tailnet browser ── Tailscale Serve ───┘              │
                                                     ├─ .wrangler named volume
                                                     ├─ MCP Gatekeeper ─HTTPS─> ASB
                                                     └─ Other OpenAI
                                                          │ Docker DNS
                                                          v
                                                LiteLLM :4000
                                                          │ HTTPS
                                                          v
                                              OpenCode Go / GLM-5.2

host diagnostics ── 127.0.0.1:4001 ──> LiteLLM
```

Docker publishes both ports only on `127.0.0.1`. Wrangler binds `0.0.0.0:8877`
only inside the container so Docker can forward loopback traffic. LiteLLM listens
on its container interface for the same reason. There is no LAN-wide host bind,
router port mapping, Funnel, public Tunnel, or new Cloudflare resource.

## Source and branch boundaries

- `upstream` fetches `cloudflare/cloudflare-os`; its push URL is disabled.
- `main` follows `upstream/main` and carries no personal commits.
- `home` contains this machine's operational layer.
- `feature/*` is for separable home changes.
- `contrib/*` starts from `upstream/main` for small candidate fixes only.
- A future `origin` will point to the user's fork only after explicit approval.

Operational files live under `ops/home/`. Three core edits remain because external
files cannot provide the behavior: disabling persistent generated-UI watchers in
a long-running container, passing an explicit Wrangler bind IP, and deriving each
Gatekeeper OAuth base URL from `PUBLIC_BASE_URL`. Each is isolated in
`run-dev-server.js` or `scripts/dev-server-config.js` and covered by tests.

## State boundaries

Cloudflare OS state is stored in the named volume
`cloudflare-os-home-wrangler`, mounted at `/workspace/.wrangler`. The pnpm store is
a separate disposable cache volume. LiteLLM has no persistent database: spend
logs are disabled, request/response body logging is disabled, and model routing is
declarative.

A network-isolated one-shot init service owns only the two named mounts and the
`CHOWN` capability. It assigns them to UID/GID 1000 and exits before the non-root
Cloudflare OS service starts. This handles both fresh and restored Docker volumes
without running the application as root.

The Cloudflare OS container also enables Docker init's process-group signal
forwarding. The official local runner synchronously launches pnpm/Wrangler below
Node; group forwarding lets a Compose stop reach that entire tree instead of
waiting for the grace period and forcing a kill.

Backups stop only Cloudflare OS, archive the `.wrangler` volume, and restart the
service if it was previously running. Restore always creates a new volume and a
separate stack/port. It never writes into the live volume.

## Model compatibility boundary

Cloudflare OS's current `Other OpenAI` provider uses the OpenAI Responses API.
OpenCode Go exposes Chat Completions for model ID `glm-5.2`. LiteLLM v1.95.0 is
pinned and configured with `use_chat_completions_api: true`, making this conversion
explicit. The local mock QA proves normal and function-tool round trips before any
real inference is permitted.

The proxy version and conversion behavior were checked against the official
[LiteLLM v1.95.0 source](https://github.com/BerriAI/litellm/tree/v1.95.0); the
container remains digest-pinned even if that tag is later moved.

There is exactly one route, no provider fallback, no paid OpenAI API fallback, no
automatic retry, and initial concurrency one. A future CLIProxyAPI/Codex route is
independent, direct from Cloudflare OS, manually selected, and outside MVP.

## ASB boundary

ASB is connected only through official `gatekeeper-mcp`; Cloudflare OS does not
receive filesystem access to the Obsidian vault. ASB's OAuth consent must be
read-only and Cloudflare OS's configurator must grant only `memory_search` for the
initial proof. The tool is added only to a deliberate conversation, not ambiently
to every Agent or Gadget. The built-in Context Gatekeeper is a separate Cloudflare
OS feature and is not ASB.
