<!-- memory-chunk@1 source=_claude/memory/docs/harvest/deploy-misc.md lines=30-64 tokens=613 -->
## Proof the console installer does the same thing on the VPS

`sudo bash deploy/dryrun/compare.sh HEAD` (committed) runs the installer as it was at the base commit and as it is now
against fake docker/git/curl/openssl/node in a private mount namespace (overlays on /etc, /usr/local/bin, /var/log;
nothing on the machine changes), and diffs every `docker` call argument by argument, the installer's output, every
file under `.axf-console` (content + mode) and the cron/update files. Scenarios: default (hub ready, wall turns on),
`AXF_WALL=off`, saved off, hub without accounts (waiting), hub down with wall saved on + existing secret,
`AXF_WALL_USERS=off`, saved users-off, `AXF_WALL_SECRET` given, axhub-projects volume present, no Coolify, new
tokens/domain on the command line. Also checked by hand: two `wallUsers` plugins (+ a `_` folder) → same
`user_paths=/api/plugins/a/%2C/api/plugins/b/`.

Result in **all 11 scenarios: docker calls identical, output identical, `.axf-console` files identical.** The only
difference is `/usr/local/bin/axf-console-update`:

```diff
-### /usr/local/bin/axf-console-update mode 755
+### /usr/local/bin/axf-console-update mode 700
 #!/usr/bin/env bash
-# One block, so bash reads it all before running: install-console.sh rewrites this file while it runs.
+# Written by framework/deploy/axf-deploy.sh (axf_update_script). One block, so bash reads it all before running:
+# the installer rewrites this file while it runs.
 {
 ...
-[ "$before" = "$(git rev-parse HEAD)" ] && [ ! -f ".../.axf-console/wall-waiting" ] && exit 0  # also re-run while the sign-in wall waits for the hub
-# The console's Activity banner reads this while the update runs (activity@1, source "update"). No secrets in it.
+[ "$before" = "$(git rev-parse HEAD)" ] && [ ! -f ".../.axf-console/wall-waiting" ] && exit 0  # unchanged (and no marker asks for a re-run)
+# Progress for the app's Activity banner (activity@1, source "update"). No secrets in it.
```

Explained: comment text only, plus mode 755 → **700** (tightened on purpose: the script embeds `GITHUB_TOKEN` for the
re-run and only root's cron runs it; `console-doctor.sh` checks the cron file, not this script's mode; `forensics.sh`
only reads it as root). Every command line is byte-identical. Same labels, env names (`AXF_TRUST_WALL`,
`AXF_WALL_SECRET`, `AXF_WALL_HUB`), markers and files (`wall`, `wall-users`, `wall-secret`, `wall-waiting`,
`update-status.json`, `env`).
