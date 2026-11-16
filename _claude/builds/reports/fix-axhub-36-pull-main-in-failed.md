# Fix axHub #36: pull main in failed

Build `fix-axhub-36-pull-main-in-failed` (Opus). Finishes the Dev Console push banner's "Pull all" for MossesX/axHub,
which had stopped at a failed pull of `main` into PR #36's branch.

## Result

| Branch | Merge of `origin/main` | Checks | Pushed |
|---|---|---|---|
| `claude/claude-sync-hold` (PR #36) | clean, no conflicts (`1057804`) | `pnpm typecheck` + `pnpm test`: 593/593 | yes; PR #36 CI re-ran by itself on `1057804`: success |
| `claude/amberx-open-url` | clean, no conflicts (`f707173`) | typecheck OK; 592/593 first run, `ssh.test.ts` failed on a randomly generated host key ("Malformed OpenSSH private key"), 16/16 on three reruns: a known flake, not the merge | yes (no open PR: #35 already merged, so no CI run) |
| `go-pass` | clean, no conflicts (`a9f6edf`; `GO-PASS.json` kept as is) | `pnpm typecheck` + `pnpm test`: 593/593 | yes (data branch, no PR, no CI run) |

Skipped branches: none.

## Keep-both decisions

None: every merge was clean. PR #36's rule (claude-sync leaves a checkout with `.claude-sync-hold` alone) and main's
newer sync change (per-project file cap 750, overwrites not counted, `9de150a`) both stand untouched.

## Notes

- The VPS host runs Node 20, which has no `node:sqlite`; the repo needs Node 22.13+. Tests ran in the `node:22`
  container (through `agent-slots.mjs heavy`). On host Node 20 five sqlite test files fail to load, which is the
  environment, not the code.
- `go-pass` is the hub's Go-pass data branch (`GO-PASS.json`, go-pass@1, written by the hub). Merging main into it is
  harmless to the hub, which only writes that one file.
- PR #36 is open, mergeable and green; the merge queue lands it.

## For Brett

Nothing to decide and no command to run. This build adds no UI, so it has no API surface.
