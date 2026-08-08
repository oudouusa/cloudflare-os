# Home pilot security

## Security posture

The primary boundary is local or tailnet-only reachability. Cloudflare OS is Early
Access software and this Compose stack runs Wrangler's development server; neither
is treated as an Internet-facing production security boundary.

- Host publishes are `127.0.0.1:8877` and `127.0.0.1:4001` only.
- Remote HTTPS is Tailscale Serve only, after review and approval of existing Serve
  state. Funnel and public Cloudflare Tunnel are prohibited.
- Both long-running containers drop all Linux capabilities and set
  `no-new-privileges`. A network-isolated one-shot init container receives only
  `CHOWN` so new/restored volumes can be handed to UID 1000 before Cloudflare OS starts.
- Docker JSON logs rotate at 10 MiB with three files per service.
- No Cloudflare Workers, KV, D1, R2, AI Gateway, or other account resource is created.

After the owner's first account is created, an administrator must disable new
signups in Cloudflare OS Admin settings. The current home volume has one owner
account and the unauthenticated `/signup` browser probe reports registration
closed. Sharing links and additional-user behavior remain outside MVP and require
explicit QA before use.

The official local runner sets `ADMINS` to the exact username `admin`; that is why
the first private owner account uses that name. This is a development-runner
convention, not a substitute for the Tailscale reachability boundary.

Current source contains an **Allow new sign-ups** Admin toggle and enforces the
stored value in password, Gatekeeper, and Access account-creation paths. Runtime
acceptance also requires the unauthenticated closed-signup probe to remain green
after restart and restore.

## Secrets and private data

`ops/home/.env` is ignored and must be mode 600. It contains the OpenCode Go key
and LiteLLM master key. Never put real values in `.env.example`, shell history,
screenshots, Git output, or issue text. Evidence remains under ignored
`ops/home/evidence/` and must exclude usernames, tailnet names, tokens, ASB result
text, and personal content.

The `.wrangler` volume and its backup can contain accounts, chats, configured model
credentials, Gadgets, and connection tokens. Backup directories and files are
owner-only and must remain on the Linux filesystem. Do not sync them to a public or
shared location without separate encryption and review.

Run before every commit:

```bash
node ops/home/qa/check-secrets.mjs
git status --short
```

The scanner is a guardrail, not proof that arbitrary private text is absent.
Review diffs and evidence manually as well.

## Provider and cost controls

The single LiteLLM route is OpenCode Go `deepseek-v4-flash`. No ZAI, AWS, Bedrock,
NVIDIA, Gemini, OpenAI API key, fallback, or automatic retry is configured. LiteLLM
request body logging, spend logs, and telemetry are disabled.
`COST_GUARDRAILS.md` is the authoritative pre-inference checklist.

## ASB least privilege

Connect ASB over its HTTPS MCP endpoint through `gatekeeper-mcp`. At ASB consent,
choose the read-only grant. In the Cloudflare OS tool grant, select only
`memory_search`. Do not grant capture/write/correction/sync tools, do not change ASB
OAuth scopes, and do not expose the Vault filesystem. Remove the ASB connection
from the conversation after the test. Capture only the tool name, success state,
timestamp, and redacted result count as evidence.

Choose **named tools**, not **all tools**, even though the initial OAuth read grant
currently exposes only three reads. The named-tool fragment is enforced on every
call and prevents a future read-tool addition from widening the Cloudflare OS
binding. ASB's read grant independently omits every write and capture tool at the
server, so this is defense in depth rather than reliance on annotations alone.

## Incident response

If a key may have appeared in Git, logs, or evidence, stop inference and remote
access immediately. Preserve filenames and timestamps without reproducing the
secret, rotate the affected credential at its provider, replace the local value,
and inspect Git history before any push. If a backup is exposed, treat every token
and private record within the Cloudflare OS state as potentially compromised.
