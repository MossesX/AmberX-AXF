# review-schema: one schema for everything in UI Review (Nov 1 2026)

Headless VPS build, Opus, one session, branch `claude/review-schema` → main. Built on top of shots-tab + shot-groups
(waited for shot-groups; it landed at 247d6a47 / ce73487a and was merged in).

Brett: "ANYTHING that goes into UI Review (the approve/reject queue AND Screenshots), from ANY source (Claude chat or
voice, agents, headless builds, console, plugins, manual uploads) MUST have a NAME and a TIMESTAMP and conform to ONE
schema. No exceptions."

## What changed

**1. The schema** (`framework/core/ui-review-schema.mjs`, pure JS, + `.d.mts`)
- `ui-review-item@1`. Required fields: `$axf`, `id`, `name` (human: has letters, isn't a file name, an id or a slug with
  digits), `group {id, name}`, `createdAt` (ISO timestamp), `kind` (`review` | `screenshot`), `source`
  (claude-chat, claude-voice, claude-code, headless, agent, console, plugin, manual, watch-live), `submittedBy`
  `{type: session|build|agent|user, id}`, `app`, `screen`, `viewport` (phone, desktop, tablet, mixed), `files
  {before[], after[]}` (at least one picture), and `status` on review items (pending, approved, rejected, changes).
  Screenshots may not carry a status. Optional fields: note, pr, branch, build `{id, step}`, section (the queue's
  kinds), comment, history, pairId. Fields it doesn't know are kept.
- `ui-review-group@1`. Required fields: id, name, createdAt, source. Optional: submittedBy, app, note, build, session.
- One registry (`REGISTRY`) holds the field lists and vocabularies. `axf schemas` writes it as
  `framework/schemas/ui-review.json` (the Python server reads this file) and writes the JSON Schemas
  `framework/schemas/json/ui-review-{item,group}.schema.json`.
- Errors name the field: `ui-review-item@1 rejected: name is missing — every UI Review item needs a human name, e.g. "Breakroom phone check"; createdAt is missing — …`.
- `prepareItem` fills in only two things: `createdAt` = now and, when nobody can ask Brett, the automatic group
  `<source/session> - <YYYY-MM-DD HH:mm>`. It never fills a missing name. It accepts older spellings as aliases (same
  value, not defaults): title → name, notes → note, waiting → pending.
- Fixtures (`framework/spec/fixtures/ui-review-item.json`, 27 items + 4 groups) are the contract. The JS validator
  and the Python validator (`apps/console-web/plugins/ui-review/server/schema.py`) both pass all of them.

**2. Checked at every intake.** Both stores convert at one boundary: `web/conform.mjs` in JS, `server/conform.py`
in Python. Each refuses to write any record that fails the schema (`saveDoc` / `saveShots` / `_save_items` /
`Store._write`), so no path, including future ones, can store a bad item. Intake paths:
- `POST /submit` (queue) and `POST /shots` (Screenshots: JSON base64, multipart, the Upload button). Errors come back
  as 400 with the message above, and nothing is written (no picture, no empty group).
- `review.mjs submit` / `shot.mjs` / `axf shot`: they now take `--name` (`--title` still works), `--app`, `--screen`
  and `--group`. Source and sender come from `--source` / `--by type:id`, or are detected from the Claude Code session
  running the command (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`; headless when `CLAUDE_CODE_SESSION_ATTENDED=0` or
  `AXF_SESSION`, sender = `build:<branch>`). They are never guessed: with no session around, the item is refused.
  Both CLIs check the files' content and every field before making a group or copying a file.
- `rebuild-shots --submit` passes `--name`, `--app`, `--group`, `--source`, `--by`, `--step` through. Screen = the shot
  names, or `--screen`.
- The `ui-review@1.submit` capability (other plugins) and Send to review (promote) go through the same `submit()`.
  Promoted items keep the screenshot's screen and go into a queue group with the same name as the screenshot's group.
- Build briefs (Build manager `orchestrate.mjs`, orchestrator `orchestrator-core.mjs`) now show the
  `--name … --app … --screen … --group …` form.
- AmberX: it has no upload code of its own. It uses the console page and API, which are covered above.
- The page now gets ui-review-item@1 from `GET items` / `GET shots` and converts it to its working shape. The Upload
  panel asks for the group name (new groups), a name, the app and the screen. Pick pictures stays disabled until all
  of them are filled in. With several files, each one is named `<name> · <file>`.

**3. Migration** (`apps/console-web/plugins/ui-review/migrate.mjs`)
- `review.mjs migrate` does a dry run and prints a report. `--apply` backs up both files (`*.pre-schema-<time>`) and
  writes them. `review.mjs check` confirms every stored record conforms.
- Names come from titles (else the screen or the file name). Timestamps come from submittedAt / takenAt (else the
  picture's file time). Queue items are grouped by build and day. Screenshots keep their groups; ones with no group
  use Screenshots' own title-prefix rule, e.g. `Breakroom check - 2026-10-31 20:29`. Older sources are mapped:
  cli/check → claude-code, api → console, build/pr → headless. Design-pack decisions move to `packDecisions`.
  `shot-group@1` becomes `ui-review-group@1`.
- The server runs the migration on start (through node, which the image ships). It keeps the report as
  `schema-migration.md` in the data folder and also serves `POST /migrate {apply}` and `GET /schema`.
- **Live data was not touched from here.** The console running now is the old code and would not read the new format.
  The new console migrates the data on its first start. Dry run on a copy of the live folder:
  [review-schema-migration-dryrun.md](review-schema-migration-dryrun.md). Result: 6 queue items, 10 screenshots,
  17 records changed, 0 still non-conforming. Applying it to the copy and starting the new server on another copy both
  worked (`check` ✓; server start-up migration applied 17 with 0 errors, then served all of it).

**4. CI.** `node framework/spec/check-ui-review.mjs` now runs in `.github/workflows/android.yml` (71 checks). It covers:
- the fixtures and the error messages;
- the registry and JSON Schema snapshots being up to date;
- the intake defaults (a name is never filled; same group name on the same day = the same group);
- migration, including idempotency;
- a repo scan: code that calls the submit API must use the validator or the CLIs, and every documented
  `review.mjs submit` / `shot.mjs` / `axf shot` command must pass `--name`. The scan caught one stale example in the
  shot-groups rule, now fixed.

Design packs: their projected items and groups are checked against the schema in both test suites.

**5. Rules.** `_claude/shared/rules/RULES.md` has one new line: everything in UI Review has a name, a timestamp and one
schema, and Claude asks Brett for the group name before sending on his behalf. The "Every UI change" and Screenshots
command examples were updated to the new flags.

## Tests

| Check | Before | After |
|---|---|---|
| `ui-review/test.py` | 120-ish (shots-tab + groups) | **155 ok**: fixtures through the Python validator, every missing field refused by name on submit + shots, no picture or group left behind, stored files conform after every write, rename reaches stored group names, migration dry run / apply / backups / idempotent, design packs conform |
| `ui-review/test.mts` | 20 groups | **23 groups ok**: conform round trips, caller detection, CLI refusals, shot CLI, groups, migration end to end |
| `framework/spec/check-ui-review.mjs` | — | **71 ok** (new, in CI) |
| console `tsc --noEmit` + `vite build` (fresh bake) | ok | ok |
| `check-theme`, `check-controls`, `check-plugin-pages`, every `plugin-lifecycle check` | ok | ok |
| Full local block (android.yml web steps + every plugin test.mts / test.py) | — | 96 pass, 13 fail. All 13 fail the same way on a clean origin/main worktree here, so they're environment, not this build: `tracker --check`, `plugins --check`, `check-orch-sync.mjs` (the file CI calls isn't in the repo), `session-checkin`, and the alerts-bell, changes-grid, claude-handoff, fable-rebuilds, feature-assist, hub-sync, main-build-status, theme-manager and voice-notes Python tests |

## UI Review

Phone + desktop shots of the Screenshots group list and the new Upload panel
(`_claude/memory/docs/ui-review/review-schema/shots/after/`) were submitted as **r-20261101-b57bz01**, waiting for Brett.

## Known gaps

- The Upload panel always asks for one app and one screen per batch. Several screens in one upload need several uploads.
- Status ids differ between layers: stored as `pending`, still `waiting` in the page's working shape and in the
  `ui-review@1` state API (an existing contract the push banner reads).
- No Android twin: Android work is on hold. The contract is pure JS + Python, so a Kotlin twin would be one file plus
  the shared fixtures when Android resumes.
