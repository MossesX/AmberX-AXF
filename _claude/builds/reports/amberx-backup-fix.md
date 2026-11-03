# amberx-backup-fix — AmberX app database backups (Urgent, Nov 3 2026)

Requested by Brett (voice), Opus, VPS session. Branch `claude/amberx-backup-fix`.

## Symptom

`amberx-app-backup-1` (postgres:17 sidecar in the `amberx-app` compose stack) was in a restart loop
(`Restarting (2)`, 22,029 restarts). The last dump in `/opt/amberx-app/backups` was
`amberx-2026-10-03-031500.dump.gz`: a month with no backups.

## Cause

`/opt/amberx-app/src/deploy/prod/backup.sh` has CRLF line endings. The source tree is a snapshot uploaded
from Brett's Windows checkout (`C:\Home\Projects\AmberX`, files owned by uid 197608, Git for Windows), so git
converted the script to CRLF on checkout. `/bin/sh` (dash) read line 16 as `set -eu\r`, failed with
`set: Illegal option -` and exited 2; `restart: unless-stopped` restarted it forever.

The script is a single-file bind mount, so the container had kept the earlier (LF) inode until it was restarted
around Oct 3, when it picked up the CRLF copy.

It is not a Coolify app: the stack is plain compose, project `amberx-app`, file
`/opt/amberx-app/src/deploy/prod/docker-compose.yml`, env `/opt/amberx-app/.env`, deployed by the AmberX
repo's `tools/deploy.ts`.

## Fix (on the VPS)

1. `backup.sh` converted to LF (original kept as `backup.sh.crlf-<timestamp>.bak` next to it).
2. Compose `backup` service, so a future Windows upload can't break it again:
   - the script is mounted at `/opt/backup/backup.sh` and the entrypoint copies it to
     `/usr/local/bin/backup.sh` with carriage returns stripped (`tr -d '\r'`), then execs it. That path is still
     what `npm run db:backup` (`docker compose exec backup /bin/sh /usr/local/bin/backup.sh --once`) runs.
   - healthcheck changed from `test -d /backups` to "a dump younger than 26 h exists"
     (`find /backups -name 'amberx-*.dump.gz' -mmin -1560`), so stale backups show as `unhealthy`.
   - original compose kept as `docker-compose.yml.<timestamp>.bak`.
3. Only the backup service was recreated (`docker compose -p amberx-app --env-file /opt/amberx-app/.env up -d
   --no-deps --force-recreate backup`). Postgres, its data volume and the other services were not touched.

**Carry this into the AmberX source repo** (on Brett's Windows checkout), or the next `tools/deploy.ts` upload
brings the old compose back (the entrypoint guard then goes away, though an LF script would still run):
- add `.gitattributes` with `*.sh text eol=lf`, then `git add --renormalize .`;
- copy the `backup` service changes above into `deploy/prod/docker-compose.yml`.

## Verified

- Container up and `healthy` for 5+ minutes after the recreate; daemon log: `nightly at 03:15 UTC into /backups,
  keeping 14 days`.
- One dump taken at once: `amberx-2026-11-03-141100.dump.gz`, 1,714,573 bytes, `gunzip -t` OK,
  `pg_restore --list` 645 TOC entries / 120 table-data entries, and a full restore into a throwaway postgres:17
  container finished with no errors (122 tables). The scratch container was removed.
- Before that dump ran, the 15 old dumps (Sep 19 – Oct 3) were copied to `/opt/amberx-app/backups-archive/`
  (sha256-verified), because the first good dump rotates out everything older than 14 days. That folder is
  outside the rotation; delete it whenever it's no longer wanted.

## Where the backups live, schedule, retention

- Dumps: `/opt/amberx-app/backups/amberx-<UTC stamp>.dump.gz` (pg_dump custom format, gzipped).
- Schedule: daily at 03:15 UTC (`BACKUP_AT_UTC`), by the sidecar's own sleep loop.
- Retention: 14 days (`BACKUP_KEEP_DAYS`), rotated only after a successful dump.
- Restore: `npm run db:restore <file>` (`tools/deploy.ts --restore`, stops the writers first).

## Alert

New health@1 check `amberx-backups` ("AmberX app backups", systems check, service vps) in
`apps/console-web/plugins/systems-check/server/healthchecks.py`: red when the backup container is in a restart
loop, not running, missing from the stack, or `unhealthy` (newest dump older than 26 h). Red items are pushed
once to the AmberX app like every other systems-check item. Six new tests in `systems-check/test.py`
(222 checks pass). It goes live with the next console deploy after the PR merges.
