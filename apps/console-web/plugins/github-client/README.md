# GitHub client (github-client@1)

Builds → GitHub client. Every pull request of the project's repos with its status, checks, commits behind main,
conflicts, review, linked build and merge-queue position; merge (through the merge queue), pull main in, rebase,
close, reopen, comment, re-run checks; batch merge (several PRs on one branch, landed as one PR, clashes handed to
Claude); bulk actions; branches, commits and diffs; one searchable git log with Restore for deleted branches.

Design: `DESIGN.md`. Contract (records, reads, commands, deep links, voice): `contract.json`. Self-test: `python3 test.py`.

How to reach each part without the UI (all four the same, from plugin-commands@1):

| What | REST | MCP | CLI | Voice (AmberX) |
|---|---|---|---|---|
| PR list | `GET /api/control/github-client/prs?filter=ready` | `github-client_prs` | `axf github-client prs --filter ready` | "what's ready to merge" |
| Merge | `POST …/merge {owner,name,n}` | `github-client_merge` | `axf github-client merge --owner MossesX --name AmberX-AXF --n 123` | "merge PR 123" |
| Pull main in | `POST …/update-main` | `github-client_update-main` | `axf github-client update-main …` | "pull main into 123" |
| Batch merge | `POST …/group-create {prs:[…]}` | `github-client_group-create` | `axf github-client group-create --prs 120,121` | "batch 120 121 and 122" |
| Bulk | `POST …/bulk {action}` | `github-client_bulk` | `axf github-client bulk --action close-stale` | "close the stale PRs" |
| Git log | `GET …/log?q=…` | `github-client_log` | `axf github-client log --q …` | "show the git log for today" |
| Deep link | `console_show github-client` focus `pr 123` | `github-client_open` | `axf github-client open --args "prs ready"` | "show PR 123" |

Merge, pull main in, rebase, batch land and bulk answer 403 to a caller that says it is Claude (`X-Axf-By`): those are Brett's.
