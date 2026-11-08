<!-- memory-chunk@1 source=_claude/memory/docs/harvest/deploy-misc.md lines=143-151 tokens=162 -->
## Left for later

- Build Pilot adopts `axf-deploy.sh` (steps in `framework/deploy/README.md`; run a copy of `deploy/dryrun/` on its installer).
- Template server's `wall.py` duplicates the console's rules; switch it to `framework/python/axf_server/wall` once the
  axf-server group lands it (noted in the file).
- The console could bind to `hub-accounts` directly (drop `console-access`) — deliberately not done (no behaviour change).
- Pre-existing shellcheck findings in `install-console.sh` (SC2097/SC2098 on the doctor line, SC2086/SC2116 in the
  volume message) left untouched to keep the diff empty; CI shellchecks only `framework/deploy`.
