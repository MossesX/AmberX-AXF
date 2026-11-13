# MERGE-CONFIRM — a merge is merged once GitHub confirms it (merge-confirm@1)

Status: contract since Nov 13 2026 (build `merges-are-only-merged-once-github-confirms-every-merge-path-console-auto-me`, Fable).
Reference implementation: `framework/core/merge-confirm.mjs` (pure, IO-free). Check: `node framework/spec/check-merge-confirm.mjs`
(`--write` regenerates `framework/spec/fixtures/merge-confirm.json`). Registry snapshot `framework/schemas/merge-confirm.json`,
JSON Schema `framework/schemas/json/merge-confirm.schema.json` (`axf schemas`). The IO side (`framework/cli/merge-confirm.mjs`:
read the PR back through `github-token.mjs`, compare against main) and the pending store + poller in the push banner plugin
are built on this module and never decide anything themselves. No Kotlin twin: build tooling, nothing an Android app renders
(recorded in `PORTING.md`).

## Why

Every merge path (the merge queue, auto-land, the console's auto-merge, the GitHub plugin's merge action, the console server's
merge gate, deploy and CLI scripts) used to call GitHub's merge API and, on a 200, write "merged": the stack entry was dropped,
the build went `complete`, the redeploy fired. A 200 is GitHub's *promise*; the PR was seen still open afterwards, and a client
timeout on a merge that did go through was reported as a failure. From now on **nothing is "merged" until GitHub says so when
read back**, and every path shows the same word meanwhile: **Pending GitHub confirmation**.

## States

```
merge-requested ──called──▶ pending-github-confirmation ──observe──▶ merged
                                      │                              (terminal, the only "merged")
                                      ├──observe (PR closed unmerged, or still open after a refused call)──▶ merge-failed
                                      └──timeout (no proof within the deadline)──▶ merge-unconfirmed ──recheck──▶ pending-github-confirmation
```

| State | Label (every UI, API, CLI, voice) | Meaning |
|---|---|---|
| `merge-requested` | Merge requested | The record is written **before** the merge call, so a process that dies mid-call still gets read back. |
| `pending-github-confirmation` | Pending GitHub confirmation | The merge call answered (any answer, including an error or no answer after `callTimeout`). Nothing is decided from the answer. |
| `merged` | Merged | GitHub, read back, gave the full evidence (below). The only state a path may call merged. |
| `merge-unconfirmed` | GitHub hasn't confirmed | The deadline passed without full evidence (PR still open, read errors, or MERGED but the commit not on main yet). Stays in the queue as "awaiting GitHub"; raises one health banner item; `recheck` reopens it. |
| `merge-failed` | Merge failed | GitHub said no: the PR is closed without a merge, or it is still open and the merge call was a definitive refusal (HTTP 405 / 409 / 422). A new `request` on the record is a new attempt. |

`isMerged(record)` is the one question every path asks; it is `state === 'merged'` and nothing else.

## Evidence (all four, from GitHub read back, never from the merge call's answer)

| Fact | From the PR read | Missing → |
|---|---|---|
| `state` MERGED | REST `merged: true` (REST reports `state: closed` + `merged`), or GraphQL `state: "MERGED"` | not merged yet |
| `mergedAt` | `merged_at` / `mergedAt`, ISO | `merged_at` |
| `mergeCommitSha` | `merge_commit_sha` / `mergeCommit.oid`, 7–40 hex | `merge_commit_sha` |
| `onMain` true | the main read: `{ contains: true }`, a compare of `merge_commit_sha…main` with status `ahead` or `identical`, or main's head sha equal to the merge commit | `merge commit on main` |

`evidence(prRead, mainRead, at)` normalises both reads into `{ state, mergedAt, mergeCommitSha, onMain, mainSha, shaMatch, readAt, missing }`
and `verdict(evidence)` answers `merged | not-merged | closed | pending | unknown`. `shaMatch` compares the merge call's `sha` with the
merge commit GitHub reports (prefix match, 7+ chars); a mismatch is noted in the history but GitHub's commit wins. A read that
failed (`{ error: { status, message } }`) is `unknown` and never ends a record: it waits for the next read-back.

## Read-back schedule, retries and the deadline

| Rule | Value | Where |
|---|---|---|
| First read-back | right after the merge call answers (`nextCheckAt` = `calledAt`) | `called` |
| Backoff between read-backs | 0, 5, 15, 30, 60, then 120 s for every further check | `BACKOFF_S`, `nextDelayMs(checks)` |
| Deadline | 10 min from `requestedAt` (from the recheck time after `recheck`) | `TIMEOUT_S`, `deadlineAt` |
| Merge call with no answer | after 2 min a `merge-requested` record is due for a read-back as if the call had answered "unknown" | `CALL_TIMEOUT_S`, `due` |
| Definitive refusals | HTTP 405 (not mergeable), 409 (head moved), 422 (validation): still read back once; `merge-failed` only if the PR is then not MERGED | `REFUSAL_STATUSES` |
| Retrying the merge | never automatic here; a path that retries calls `request` again on the same record (`attempt` + 1, history kept) | `request` |
| Recheck | `recheck` moves `merge-unconfirmed` back to pending with a fresh deadline and `rechecks` + 1 (REST POST …/recheck, MCP, CLI, voice `merge.recheck`) | `recheck` |

`observe(record, prRead, mainRead, at)` is idempotent on a terminal record and is allowed in `merge-requested` too (a read-back never
hurts). `timeout(record, at)` turns any non-terminal record past its deadline into `merge-unconfirmed`; `observe` applies the same
rule after an inconclusive read, so a poller needs only `observe` + `timeout`.

## The record each merge path writes (merge-confirm@1)

```
{ $axf: 'merge-confirm@1',
  id: '<owner>/<repo>#<pr>'              one record per PR (lowercase repo); a new merge call on the same PR is a new attempt
  repo, pr, url,                         repo 'owner/name' lowercase; pr integer; the PR's html_url when known
  path:  merge-queue | auto-land | console-auto-merge | github-plugin | server-gate | script | cli | reconcile
  by:    who asked (agent, user, job)    build: the builds@1 id it lands, '' when none
  state, label, attempt, rechecks, checks,
  requestedAt, calledAt, deadlineAt, nextCheckAt, confirmedAt, endedAt      (ISO UTC, '' when not yet)
  call:     { ok, status, merged, sha, message } | null          what the merge API answered: a hint, never evidence
  evidence: { state, mergedAt, mergeCommitSha, onMain, mainSha, shaMatch, readAt, missing } | null   the last read-back
  why:      one sentence for merge-unconfirmed / merge-failed / a pending wait ('' when merged)
  history:  [{ at, from, to, why }]      every transition, newest last, capped at 40 }
```

`reconcile` is the path for readers that never call merge (builds-live, builds-reconcile, the Shipped ledger): they `request`
with `call: null`, `observe` the PR they saw merged, and mark the build complete only on `merged`.

## Who writes what

| Path | Writes | Reads `isMerged` before |
|---|---|---|
| merge queue (`push-banner/land/merge-queue.mjs`) | `request` → merge call → `called` | dropping the stack entry, counting a landed PR, the one-per-stack redeploy |
| auto-land + console auto-merge (`push-banner/server`, `land/auto-land.mjs`) | same | reporting `merged: true` in its round summary |
| GitHub plugin merge action + server merge gate | same; answers `{ state: 'pending-github-confirmation', id }` with the confirm id | the gate's "merged" answer |
| scripts (`deploy/`, `framework/cli/`) | same through `framework/cli/merge-confirm.mjs confirm <repo> <pr> --wait` | continuing after a merge |
| builds-live / builds-reconcile | `request` (path `reconcile`, no call) + `observe` | marking a build `complete` / `mergedAt` |

Every state and action is reachable without the UI: REST `GET /api/plugins/push-banner/merge-confirm` (list, `?state=`, `?id=` for one), <!-- axf-plugin:push-banner -->
`GET …/merge-confirm/get?id=<repo>#<pr>`, `POST …/merge-confirm/recheck` {id | repo, pr}; MCP `push_banner_mergeconfirm_list | get | recheck`;
CLI `merge-confirm.mjs status | list | confirm | recheck`; voice / console action `merge.recheck[:<repo>#<pr>]` (no PR = every
unconfirmed one); deep link `console_show push-banner/merge-confirm/<repo>#<pr>` (Settings → Plugins → Push banner, the record
highlighted; the action `push-banner.focus:merge-confirm/<repo>#<pr>`). <!-- axf-plugin:push-banner -->

## Deferred

- Kotlin twin: none planned (build tooling; Android on hold). Recorded in `PORTING.md`.
- A GraphQL read (`state: MERGED` directly) is accepted by `evidence` already; the IO helper uses REST first.
