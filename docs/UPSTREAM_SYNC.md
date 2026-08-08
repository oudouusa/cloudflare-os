# Upstream synchronization

## Branch invariants

- `upstream` is `https://github.com/cloudflare/cloudflare-os.git`; push is disabled.
- `main` is a clean fast-forward mirror of `upstream/main`.
- `home` contains personal operational commits.
- `feature/*` starts from `home`; `contrib/*` starts from `upstream/main`.
- Never force-push, delete an existing branch, or rewrite published history.

Before the first approved GitHub push, add the user's fork as `origin`. Until then,
there is intentionally no `origin` and no external write.

## Inspect before integrating

```bash
git status --short --branch
git fetch --prune upstream
git log --oneline --decorate --left-right main...upstream/main
git diff --stat main..upstream/main
git diff main..upstream/main -- run-dev-server.js scripts/dev-server-config.js
```

Stop if the worktree has unknown changes or upstream substantially redesigns local
execution, Gatekeepers, model providers, or state. Record the exact old and new
upstream SHAs and recheck Node, pnpm, Wrangler, `Other OpenAI`, and all reference
assumptions.

## Update `main`

```bash
git switch main
git merge --ff-only upstream/main
git status --short --branch
```

No home commit is permitted on `main`.

## Integrate into `home`

The repository policy forbids history rewriting, so the normal published-home
procedure is a merge, not a rebase:

```bash
git switch home
git branch backup/home-before-sync-YYYYMMDD
git merge --no-ff main
```

The requested “home rebase” checkpoint is still evaluated on every sync. A rebase
would be technically:

```bash
git rebase main
```

but it rewrites home commit IDs and is therefore **not executed under the current
no-history-rewrite rule**, especially after `home` exists on `origin`. If a future
one-time, unpublished branch rebase is desired, stop and obtain explicit policy
clarification first; never pair it with force-push.

Resolve conflicts by preserving current upstream behavior and reapplying only the
small operational intent. Do not copy the reference repository's vendored source.

## Required post-sync tests

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm test
ops/home/qa/check-symlinks.sh
ops/home/qa/check-config.sh
node ops/home/qa/check-secrets.mjs
docker compose --env-file ops/home/.env -f ops/home/compose.yaml config --quiet
docker compose --env-file ops/home/.env -f ops/home/compose.yaml build cloudflare-os
```

Then run the no-cost bridge test, localhost health/persistence test, and a new
backup/isolated restore test. Real OpenCode regression calls still require current
Use balance OFF confirmation.

The symlink audit must report the exact 23 official links and live targets both on
the host and inside the image. A flattened or changed link set blocks the sync
until the upstream change is understood.

## Rollback without destructive reset

If integration fails, preserve the failed branch and return to the backup branch:

```bash
git branch home-sync-failed-YYYYMMDD
git switch backup/home-before-sync-YYYYMMDD
```

Do not run `git reset --hard`, delete the failed branch, overwrite the live volume,
or roll a restored volume into production. Keep the previous image tag and backup
until the synchronized stack and isolated restore both pass.
