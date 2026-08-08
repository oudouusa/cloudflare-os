# Backup and restore

Cloudflare OS local state lives in the `.wrangler` named volume. The archive can
contain credentials, account records, chats, and Gadgets. Keep it in an owner-only
Linux directory, never under `/mnt/c`, and treat it as secret material.

## Consistent backup

The backup script stops only `cloudflare-os` if it is running, reads the named
volume, writes the archive and metadata with owner-only permissions, verifies
checksums, and restarts the service if it was previously running. LiteLLM remains
available; no model call is made.

After stopping, the script inspects the container exit state. Exit 137 or an OOM
flag blocks the archive rather than treating a forced/unsafe stop as a consistent
snapshot. The exit trap still attempts to restart a service that had been running.

Choose an explicit Linux-side root that is dedicated to these backups:

```bash
mkdir -p /home/gpdmini/cloudflare-os-private-backups
chmod 700 /home/gpdmini/cloudflare-os-private-backups
ops/home/scripts/backup.sh /home/gpdmini/cloudflare-os-private-backups
```

Each timestamped directory contains:

- `wrangler.tar`: a numeric-owner archive of the volume.
- `metadata.txt`: UTC timestamp, upstream/home SHA, dirty state, image name/ID,
  source volume, and normalized Compose hash.
- `SHA256SUMS`: checksums for the archive and metadata.

The Compose hash is generated from the uninterpolated configuration so secrets do
not enter metadata. The script never runs `down -v`.

## Restore into a new volume

Never restore directly into `cloudflare-os-home-wrangler`. Pick a unique volume
name and an exact timestamped backup directory:

```bash
ops/home/scripts/restore-new-volume.sh \
  /home/gpdmini/cloudflare-os-private-backups/20260808T120000Z \
  cloudflare-os-home-restore-20260808T120000Z
```

The script verifies checksums, rejects the live or any existing volume, creates a
new labeled volume, and extracts only into that empty volume. On failure it leaves
the new volume for inspection. The short-lived extraction container runs as root
so it can populate a fresh Docker-owned mount while preserving numeric ownership;
the application itself remains non-root. A completion marker is written only after
tar succeeds, and the verification launcher rejects the live volume and any volume
without that marker. It never deletes a volume automatically.

## Verify on isolated ports

Start the restored volume on port 18877 with a no-cost mock provider:

```bash
ops/home/scripts/start-restore-verification.sh \
  cloudflare-os-home-restore-20260808T120000Z
```

Open `http://127.0.0.1:18877` and verify all three with actual records:

1. the owner account can log in;
2. a known chat and its messages are present;
3. a known Gadget opens with its expected files/state.

Record redacted evidence and compare the backup metadata to the tested image and
source. Do not generate paid inference for restore verification.

The verification stack uses project name `cloudflare-os-home-restore`, LiteLLM
diagnostics port 14001, a separate pnpm cache, and the explicitly named restored
`.wrangler` volume. It must not attach the live volume.

## Failure handling

- Checksum failure: stop; do not extract or “repair” the checksum.
- Image missing: rebuild the exact local image from the recorded SHA if available.
- Container unhealthy: preserve logs and volume; do not retry extraction into it.
- Login/chat/Gadget mismatch: keep the verification volume and backup unchanged,
  compare metadata and Wrangler layout, and investigate before another attempt.
- Suspected credential exposure: stop remote access, rotate affected keys, and
  treat every private field in the archive as exposed.

Verification volumes and containers remain until the owner explicitly approves
cleanup. List them with:

```bash
docker volume ls --filter label=cloudflare-os-home.restore-verification=true
docker compose -p cloudflare-os-home-restore ps
```

Do not copy a verification volume back over the live volume. A disaster cutover
requires a separately reviewed plan, a fresh backup of the current live volume,
exact target resolution, and explicit approval.
