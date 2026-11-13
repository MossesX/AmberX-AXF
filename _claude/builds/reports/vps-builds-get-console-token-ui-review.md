# VPS builds get the console token so UI Review works, banner alert when it fails

Build `vps-builds-get-console-token-ui-review` · branch `claude/vps-builds-get-console-token-ui-review`

Brett (2026-11-13 18:13): "the VPS builds, the UI reviews, does that have anything to do with it"

## s1 Diagnosis

Yes. Headless builds on the VPS start without `AXF_TOKEN` and `AXF_CONSOLE_URL`:

- `deploy/claude-headless.sh` passes an explicit allow-list of env vars into tmux, plus a private
  secret file that carries git auth and `AXHUB_TOKEN` only. The console token was never in either.
- Confirmed in this build's own session: `AXF_DISPATCH_TOKEN`, `AXF_BUILD_ID`, … are set; `AXF_TOKEN`
  and `AXF_CONSOLE_URL` are not.
- `review.mjs submit --console` then throws `--console needs AXF_CONSOLE_URL and AXF_TOKEN` (exit 2), and
  without `--console` it writes the item into the worktree's own data folder with only a stderr warning.
- `axf shot` (shots.mjs) silently falls back to the worktree data folder when the env is missing.
- Result: review items and screenshots stay in `/root/axf-builds/<build>/…`, Brett never sees them, and
  nothing tells him. When the worktree is removed they are gone.
