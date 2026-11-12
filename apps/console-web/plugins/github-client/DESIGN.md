# GitHub client (github-client@1) — design

Build: `github-client-plugin-see-and-control-every-pr-status-merge-pull-main-in-gro`, step s1 (Fable, Nov 12 2026).
Brett's ask: see and control every PR from the console — status, merge, pull main in, group several into one, bulk
actions — with the same control from the API, MCP, the CLI and AmberX voice.

This folder holds only the design until s2 lands code. The console's loaders skip a plugin folder with no
`plugin.json` (server `load_plugins`, web `import.meta.glob` on `plugin.json` / `web/index.tsx`), so nothing here runs.
`contract.json` is the machine-readable half of this document: every record, read, command and deep link, and the
flags plugin-commands@1 needs (read-only, destructive, confirm, navigate). s2–s9 implement it; s7 checks the plugin
against it; s8's tests replay it.

## 1. What it is, in one paragraph

A console plugin, folder `github-client`, id `ai.amberx.axf.console.github-client`, name **GitHub client**. One page
(**Builds → GitHub client**, also under Plugins) with a repo selector scoped to the current project and five tabs:
Pull requests, Branches, Commits, Checks, Git log. Everything it shows is a read and everything it offers is a command
on the plugin's server part (`/api/plugins/github-client/…`), so plugin-commands@1 puts each one on REST, MCP, the CLI
and voice with no extra wiring. It reads GitHub through the framework's lib-github (`axf_server.github`), with the
token the GitHub App keeper (`github-app`) keeps in `GITHUB_TOKEN`, and talks to the existing merge queue through the
`axf.merge-queue@1` capability service. It never names another plugin's folder.

## 2. Repos per project

- **Source of repos**: project manifests (`framework/cli/projects.mjs` / `project.mjs`, field `repo: {host, owner,
  name, defaultBranch, url}`). The plugin reads `node framework/cli/projects.mjs --json` on the server (cached) and
  lists `owner/name` for every project with `repo.exists`. The active project (project-switcher, read through the
  console's current-project state, not the plugin folder) is first and selected by default.
- **Extra repos** (settings): a list of `owner/name` strings for repos no manifest names (validated by
  `github.valid_repo`). Stored in `lifecycle.dataDir/config.json`.
- **"All repos of this project"**: a project with more than one repo (framework + app repos) gets an *All* option; PR
  rows then carry a repo chip.
- `GET repos` returns `[{repo, project, defaultBranch, selected, source: manifest|extra}]`.

## 3. Records (data model)

All records are plain JSON (schemas in `contract.json → records`). Times are ISO-8601 strings.

| Record | Key fields | Where from |
|---|---|---|
| `pr` | `repo, number, title, author, head, base, draft, state (open/closed/merged), mergeable (clean/conflict/unknown/blocked), behind (commits behind base), ahead, checks {state: success/failure/pending/none, total, failed[], pending[]}, review (approved/changes/none/required), labels[], updatedAt, ageDays, stale, linkedBuild {id, title, status} \| null, queue {state: queued/landing/none, position} \| null, url` | `GET /repos/{r}/pulls` (+ per-PR `mergeable_state`, `compare base...head`, check-runs + statuses on the head SHA), builds store (`_claude/builds/store.json`: `branch`/`pr` fields that `builds-live.mjs link` sets), `axf.merge-queue@1.queue()` |
| `branch` | `repo, name, sha, ahead, behind, lastCommit {sha, message, author, at}, pr (number \| null), protected, default` | `GET /repos/{r}/branches`, `compare` |
| `commit` | `repo, sha, message, author, at, parents[], files[] (lazy), stats {additions, deletions}` | `GET /repos/{r}/commits`, `GET …/commits/{sha}` |
| `check` | `repo, ref, name, kind (check-run/status), state (queued/running/success/failure/cancelled/skipped), startedAt, finishedAt, url, runId, jobId` | check-runs + statuses; `runState()` from lib-github |
| `group` | `id, repo, name, branch (queue/group-<slug>), members[] (PR numbers), pr (the batch PR number \| null), state (building/open/conflict/landed/dissolved), conflicts[] {member, files[]}, createdAt, by` | plugin data (`groups.json`) |
| `job` | `id, kind (update-main/rebase/group/bulk/restore), state (queued/running/done/failed), items[] {target, state, note}, startedAt, finishedAt, by` | plugin data (`jobs/`) |
| `log` | `id, at, repo, kind, target {pr?, branch?, sha?, group?}, actor {kind: console/api/claude/queue, name}, outcome (ok/failed), why, details, savedSha?, restorable` | plugin data `log.jsonl`, append-only |

**Readiness** is one pure function (`ready(pr, policy)`), the same on the server and in the web part: not draft,
`mergeable = clean`, `checks.state = success` (or `none` when the policy allows), review satisfied by policy, no
`do-not-merge` label. It drives the Ready filter, the "Merge all ready" bulk action and the row's status chip, so the
UI and the API agree by construction.

**Stale**: no update for `staleDays` (setting, default 14) and not queued.

## 4. Views and deep links (console.screens)

Screen id `github-client`. `console_show {target: 'github-client', highlight?}` and control@1 `act open` on
`console.screens` with `path` = `github-client <focus>` open it; the focus grammar is the one every tab uses:

| Focus | Opens |
|---|---|
| `pr 123` / `pr MossesX/axHub 123` | Pull requests tab, row 123 expanded |
| `prs ready` / `prs stale` / `prs conflicts` / `prs failing` / `prs mine` | Pull requests tab with that filter |
| `branch feature/x` | Branches tab, that branch expanded |
| `commits main` | Commits tab on that branch |
| `commit <sha>` | the commit dialog (diff) |
| `checks <ref>` | Checks tab for a branch, SHA or PR |
| `log <query>` | Git log tab with the search filled |
| `group <id>` | the group dialog |

Dialogs (`console.dialogs`): `github-client.group` (make or edit a group), `github-client.bulk` (bulk confirm with the
per-PR list), `github-client.commit` (diff viewer), `github-client.comment` (comment on a PR).
Settings (`console.settings`): `plugins/github-client`.

### Pull requests tab (s2)
- Toolbar (`role="toolbar"`, `aria-label="Pull requests"`): repo `SelectField`, filter `Segmented` (All, Ready, Failing,
  Conflicts, Behind main, Stale, Drafts, Mine), sort `SelectField` (Updated, Oldest, Number, Behind), search
  `TextField`, Refresh `IconButton`, select-all `Checkbox`, bulk `Button` (enabled with a selection).
- Rows (`data-fx-row`, expandable): status chip (`fx-chip` tone from readiness), number and title, head → base, checks
  chip with counts, behind-main chip, conflict chip, review chip, linked build chip (opens the build in the
  orchestrator through `console.screens`), age, queue position. Expanded: failing checks with links, commits behind
  main, files changed count, the row's action `Button`s (section 5), comments count.
- Live: `GET events` (SSE) pushes record changes while the view is open; the server polls GitHub every `pollMinutes`
  (default 2) with ETags and on every command.

### Branches tab (s6)
List with ahead/behind main, last commit, PR link, protected flag; actions: Open PR (navigates to GitHub compare),
Delete (confirm; saves SHA to the log), Compare (diff dialog). Protected and default branches never offer Delete.

### Commits tab (s6)
Branch picker, list of commits, Open diff dialog (files, additions/deletions, per-file patch read from GitHub).

### Checks tab (s2, s3)
Check runs and statuses for a ref with Re-run failed / Re-run all, grouped by workflow.

### Git log tab (s9)
Searchable, expandable rows over `log.jsonl`: merges, failed merges with why, retries, branch deletes with the saved
SHA and a **Restore** button, pushes, main pulled in, PRs opened/closed, groups, bulk jobs. Import of
`_deleted-branches-*.txt` lists: `POST log/import` reads every such file in the repo root and in `dataDir/imports/`
(none exist on this checkout today; the import is idempotent on `sha+name`). Failures raise an AmberX alert through
the console's alert path (`rt.alert` from the web part for live failures; the server records them and the systems
check shows a red item while the last job failed).

### Settings → Plugins → GitHub client
Extra repos, poll interval, stale days, merge method (`queue` when the merge queue is on, else `squash`/`merge`/
`rebase`), policy switches (require green checks, require review, allow merge with `none` checks), default base
branch, lifecycle panel. Every setting is `GET/PUT config` so the API can read and change it.

## 5. Actions contract (commands)

All commands are POST routes on the server part unless marked; plugin-commands@1 derives id, REST path
(`/api/control/github-client/<id>`), MCP tool (`github-client_<id>`) and CLI (`axf github-client <id> --repo … --pr …`)
from them. `contract.json → commands` is the list `plugin.json → commands.items` will carry verbatim, so the flags below
are the single source of truth.

| Command | Route | Does | Flags |
|---|---|---|---|
| `merge` | `POST pr/{repo}/{n}/merge {method?, why?}` | Merge queue on → `axf.merge-queue@1` add (the queue lands it); off → GitHub merge with the policy's method. Refused unless `ready()` (override `force: true` is Brett's own console click only: wall owner). | write |
| `update-main` | `POST pr/{repo}/{n}/update-main` | GitHub `update-branch` (merge base into head). Conflict → a job that clones, merges, heals builds files (`builds-live.mjs heal`), pushes; other conflicts are reported, never auto-resolved. | write, job |
| `rebase` | `POST pr/{repo}/{n}/rebase` | Scratch clone rebase onto base and force-push **with lease** to the PR branch only. | write, job, confirm |
| `close` | `POST pr/{repo}/{n}/close {why?}` | Close the PR (branch kept). | write |
| `reopen` | `POST pr/{repo}/{n}/reopen` | Reopen. | write |
| `comment` | `POST pr/{repo}/{n}/comment {body}` | Issue comment. | write |
| `rerun-checks` | `POST pr/{repo}/{n}/rerun-checks {failedOnly?: true}` | Re-run failed jobs (or all) of every run on the head SHA. | write |
| `ready` | `POST pr/{repo}/{n}/ready` | Draft → ready for review. | write |
| `label` | `POST pr/{repo}/{n}/label {add[], remove[]}` | Labels. | write |
| `queue-remove` | `POST pr/{repo}/{n}/queue-remove {why}` | Take a PR out of the merge queue. | write |
| `group-create` | `POST group {repo, name, prs[]}` | Make `queue/group-<slug>` from base, merge each member branch in order, open one PR titled from `name` listing members; conflicts stop at the member and are recorded. | write, job |
| `group-add` / `group-remove` | `POST group/{id}/add {prs[]}` / `…/remove {prs[]}` | Rebuild the group branch with the new member set. | write, job |
| `group-land` | `POST group/{id}/land` | Merge the group PR (queue or direct, as `merge`); then close the members as merged-by-group and record them. | write |
| `group-dissolve` | `POST group/{id}/dissolve` | Close the group PR, delete its branch (SHA saved), members untouched. | write, confirm |
| `bulk` | `POST bulk {repo, action: merge-ready/close-stale/update-main/rerun-failed/label, prs[]? \| filter?, why?}` | One job, per-PR result; `merge-ready` only takes PRs that pass `ready()`, `close-stale` only `stale` ones. | write, job, confirm |
| `branch-delete` | `DELETE branch/{repo}/{name}` | Saves `sha` in the log, deletes the ref. Never a protected or default branch. | destructive, confirm |
| `restore` | `POST log/{id}/restore` | Recreates the branch at the saved SHA (`POST git/refs`). | write |
| `refresh` | `POST refresh {repo?}` | Drop ETags and poll now. | write (harmless) |
| `log-import` | `POST log/import` | Import `_deleted-branches-*.txt`. | write |
| `config` | `PUT config` | Settings. | write |
| `job-cancel` | `POST job/{id}/cancel` | Stop a running job between items. | write |

Reads (GET): `repos`, `prs?repo&filter&sort&q`, `pr/{repo}/{n}`, `pr/{repo}/{n}/checks`, `pr/{repo}/{n}/commits`,
`pr/{repo}/{n}/files`, `branches?repo`, `branch/{repo}/{name}`, `commits?repo&branch&page`, `commit/{repo}/{sha}`,
`diff/{repo}/{base}/{head}`, `checks?repo&ref`, `groups`, `group/{id}`, `jobs`, `job/{id}`, `log?q&kind&repo&since&page`,
`config`, `status` (token source, rate limit, cache age, queue on/off, last error). `GET events` is skipped in the
registry with the reason "server-sent events stream, not a command".

**Long actions are jobs**: a command that may take more than a few seconds answers `{job: <id>}` at once; `GET job/{id}`
and the SSE stream follow it. The CLI waits and prints the items; MCP returns the job id and `github-client_job` reads
it. Jobs run one at a time per repo (a lock in dataDir) so two bulk runs cannot race.

**Who did it**: every command logs `actor` — the console user (wall owner or admin token), `api`, or `claude` when the
control@1 command says so (`by`). The merge rule from the standing rules holds: a Claude session never merges or
updates a PR from main; those commands refuse `by: claude` with 403 and say so, and the UI and API are Brett's.

**Voice (AmberX)**: control@1 already carries plugin commands through axHub to the console (`plugins.commands`), so
"merge PR 123", "update 123 from main", "close stale PRs in axHub", "what's ready to merge" map to `merge`,
`update-main`, `bulk close-stale`, `prs?filter=ready` with no extra code. `contract.json → voice` lists the phrasings
s7 registers as examples in the plugin's help so the assistant picks the right command.

## 6. How git work runs

- **API first**: merge, update-branch, close, reopen, comment, labels, re-run, refs and compares are GitHub REST
  calls through `axf_server.github.GitHubClient` (token to the API origin only, no redirects, size cap).
- **Scratch clone** only for what the API cannot do: rebase, group branches, conflict heal. One bare mirror per repo
  in `dataDir/work/<owner>__<name>.git` with a worktree per job, fetched before each job and pruned after. Credentials
  through `framework/deploy/axf-git-cred` (installation token), never written to disk or the log (`scrub()`).
- **Never force-push** except `--force-with-lease` to the PR's own head branch for `rebase`, and never to `main` or a
  protected branch. Builds-file conflicts go through `builds-live.mjs heal`, which already knows those files.
- **Merge queue stays in charge**: when `AXF_MERGE_QUEUE=on` (read through `axf.merge-queue@1.queue()`), `merge`
  enqueues and the queue runner lands; the plugin never merges around it. With the queue off, GitHub merges directly.

## 7. Plugin rules this design meets

- Removable: code in `plugins/github-client/`, data in `.axf-console/plugins/github-client/` (config, groups, jobs,
  log, work clones), doc lines outside carry `<!-- axf-plugin:github-client -->` and are listed in
  `lifecycle.mentions`; `install.mjs` / `uninstall.mjs` / `hooks.mjs` / `help.json`; `plugin-lifecycle.mjs check`.
- Cross-plugin only by capability: `optional: service:axf.merge-queue@1, service:axf.health@1, service:axf.agents@1`
  (s4 may hand a conflicting group to an agent session), `service:orchestrator@1` for the linked-build chip (falls back
  to reading the builds store file). It `provides: service:axf.github-client@1` (reads: `prs(repo)`, `ready(repo)`,
  `log(query)`) and `view:github-client`, `settings-tab:github-client`.
- Admin-only: not `userGrantable` (it runs git and merges), not `wallUsers`. Token never reaches the browser.
- Look: tokens only (`--fx-*`), framework controls (`TabGroup`, `Button`, `IconButton`, `Segmented`, `SelectField`,
  `TextField`, `Switch`, `Checkbox`, `Container`, `Chip`), `axp-github-client` class prefix, `data-fx-row` on rows,
  every toolbar `role="toolbar"` + `aria-label`; `check-theme`, `check-controls`, `check-toolbars`, `menu-reach`.
- Menu: `web/menu.ts` → Plugins (order 50) and Builds (after the orchestrator) with `nav:github-client`.
- Help: `help.json` entries for every tab, chip, action and setting; `help-coverage.mjs --check` holds.
- Health (`axf.health@1`): `github-client` item — token source, rate limit left, last poll ok, last job ok.
- Deploy: nothing outside the console; the `gh` CLI is not required (REST only).

## 8. Step map

| Step | Delivers | From this design |
|---|---|---|
| s2 | PR list | §3 `pr`, §4 Pull requests tab, reads `repos`, `prs`, `pr/*`, `status`, `events`; `ready()` |
| s3 | PR actions | §5 `merge … label`, `queue-remove`, jobs, scratch clone (§6), log entries |
| s4 | Groups | §3 `group`, `group-*` commands, group dialog |
| s5 | Bulk | `bulk`, bulk dialog, select-all |
| s6 | Branches, commits, diffs | `branch`, `commit`, Branches + Commits tabs, `branch-delete`, diff dialog |
| s9 | Git log | `log` record, Git log tab, `restore`, `log-import`, alerts |
| s7 | API parity | `plugin.json commands.items` = `contract.json commands`; deep-link focus grammar; voice examples; CLI docs |
| s8 | Tests, report, PR | `test.py` with a fake GitHub (as main-build-status does), `contract.json` conformance check, UI Review shots |

## 9. Decisions taken here (so later steps do not reopen them)

1. Merge from the console **respects the merge queue**; it is a queue add when the queue is on. Brett asked for control,
   not a second landing path.
2. Readiness is one function shared by server, web and the bulk `merge-ready` action.
3. Long actions are jobs with per-item results; the UI, CLI and MCP all read the same job record.
4. Branch deletes always save the SHA and are restorable from the Git log; protected and default branches cannot be
   deleted from the plugin at all.
5. Conflicts are reported, and only builds-file conflicts are healed automatically (existing `heal`). Agent-assisted
   resolution for groups is optional and goes through `axf.agents@1`, decided at s4.
6. No Android or Kotlin twin: this is console-only; nothing in `framework/core` changes, so PORTING.md needs no entry.
