# PROJECTS — what a project owns (projects@1, `owns`)

Status: design, Nov 13 2026 (build `projects-own-everything-per-project-claude-accounts-and-credentials-plus-clone`, step s1,
Fable). Reference implementation to follow in steps s2 to s5: `framework/plan/projects-core.mjs` (pure) +
`framework/cli/projects.mjs` (IO, CLI), Python read mirror `apps/console-web/server/projects.py`. Check:
`node framework/spec/check-projects.mjs`. No Kotlin twin: projects are console and build tooling, nothing an Android app
renders (recorded in `PORTING.md`).

## Why

Brett, Nov 12 2026: "every project will have its own set of Claude accounts and own everything. Basically, the console and
axHub and all that runs on the project. So if you change project, everything is fresh." And the same day: "don't make the
project have to do that, but allow it to." Today a project owns its builds, notes, to-dos, tasks, lists and plans
(`projects@1`, PR #523) and nothing else: Claude accounts, credentials, plugin settings, Claude settings and the axHub
connection are one set for the whole console. This design lets a project take any of those as its own, one at a time,
while every project keeps sharing them until someone asks.

## The rule in one line

**A project shares everything by default. For each shareable thing (a *scope*) it can flip to its own copy, which lives
under the shared location in `projects/<id>/`, the same folder rule plugin data already follows.** Flipping copies the
current shared values as the starting point, so nothing goes blank. Flipping back keeps the own copy on disk, like
`delete` keeps a project's data.

## Scopes

Five scopes. Each names one store that exists today, its shared location, and what "own" means for it.

| Scope | What it covers | Shared location today | Own copy (`<shared>/projects/<id>/`) |
|---|---|---|---|
| `claude-accounts` | Which saved Claude logins and API-key accounts the project uses, which one is active for its console session and its builds, and its job routing (claude-workers@1: workers, rules, caps). Also the console's AI keys keyring (ai-keys plugin). | `~/.claude-accounts/` (logins, `active`, `workers.json`), `.axf-console/plugins/ai-keys/keys.json` | `~/.claude-accounts/projects/<id>/accounts.json` = `{ members: [names], active, workers }`; `.axf-console/plugins/ai-keys/projects/<id>/keys.json`. **Logins are never copied**: a login is stored once in `~/.claude-accounts/<name>/` and a project's own set is a membership list, so a token refresh never leaves a stale copy behind (see "Why accounts are a set, not a copy"). |
| `credentials` | The console credential vault: GitHub, Anthropic, Hostinger, Coolify, axHub URL and token, Moshi key (`CREDENTIALS` in `apps/console-web/server/credentials.py`). | `.axf-console/secrets.env` (0600) | `.axf-console/projects/<id>/secrets.env` (0600, seeded from the shared file). The own file is the whole vault for that project: no per-key fallback, so a project never silently uses another project's token. |
| `plugins` | Every plugin's settings and which plugins are on. Includes Claude settings (claude-settings@1). | each plugin's `lifecycle.dataDir` settings files; the console's enabled set; axHub `/projects/_shared/_data/claude/settings.json` | `<dataDir>/projects/<id>/…` for each plugin's settings (its *data* already goes there regardless of this scope); enabled set in `.axf-console/projects/<id>/plugins.json`; Claude settings at `/projects/_shared/_data/claude/projects/<id>/settings.json`. |
| `console` | Console settings and look: appearance source, layout, settings.ts app settings, banner widgets. | `shared/settings/apps/axf-console.json` on axHub, `shared/settings/appearance.json` | `shared/settings/apps/axf-console/projects/<id>.json`; the look follows `appearance.json` unless the project owns `console`, then `shared/settings/appearance/projects/<id>.json`. |
| `hub` | The axHub connection: address, hub project name (the `/projects/<name>/_data` tree the project's data lives in), sync choices (lib-hubsync `CONNECTION_KEY`). The token itself is a credential (`credentials` scope). | lib-hubsync connection on the device; `persistRoot()` → `/projects/<manifest name>/_data` | `hub: { url, project }` on the project record (below), used by `persistRoot()` when the project owns `hub`. |

The `repo` (owner, name, url, local path on the VPS) and the axHub folders are project attributes, not scopes: every
project has its own (the wizard requires a repo, PR #529). They are *carried over* on clone (step s5) and pre-filled in
the wizard, but there is nothing to "share".

### Why accounts are a set, not a copy

`deploy/claude-login.mjs` snapshots a login per build and `deploy/claude-token-save.mjs` writes a refreshed token back to
every store of that login. Copying `credentials` files into a project folder would add stores that go stale on the next
refresh in another project. So a login lives once in `~/.claude-accounts/<name>/`; a project that owns `claude-accounts`
owns a **set**: which logins are members, which is active, and its routing. Adding a login from inside such a project
saves it globally and adds it to the set. A login may be in several sets or none. Removing a login from a set never
deletes it; `claude-account remove <name>` (global) also drops it from every set.

## Registry (additive to projects@1)

```
{ $axf: 'projects@1', updatedAt, projects: [
    { id, name, description, profile, status, createdAt, updatedAt, archivedAt?, createdBy?,
      owns?: ['claude-accounts' | 'credentials' | 'plugins' | 'console' | 'hub' …],   // missing or [] = shares all
      ownedAt?: { <scope>: iso },                                                   // when each flip to own happened
      repo?: { owner, name, url, path },                                            // carried over on clone, wizard-filled
      hub?:  { url, project },                                                      // the project's axHub tree (hub scope)
      clonedFrom?: { id, at } } ] }
```

Rules (`projects-core.mjs`, pure):

- `SCOPES = ['claude-accounts', 'credentials', 'plugins', 'console', 'hub']`. `normalizeRegistry` keeps only known
  scopes, de-duplicated, in that order; unknown ones are dropped with no error.
- The base project (AmberX AXF) **is** the shared set: `owns` is always `[]` on it and `own` on it throws
  (`AmberX AXF is the main project: its settings are the shared ones`). Nothing moves in `migrate`: the shared
  locations stay where they are, so step s2's "migrate current ones into AmberX AXF" is a no-op on disk and a line in
  the log.
- `ownsScope(p, scope)` = `!p.base && p.owns.includes(scope)`.
- `scopeDir(baseDir, p, scope)` = `ownsScope(p, scope) ? projectDir(baseDir, p) : baseDir`. **This is the one
  resolution function**; every store above calls it (Node) or its mirror `cx.scope_dir(path, scope)` (Python). Plugin
  *data* keeps using `projectDir` / `cx.project_dir` unchanged (a project's data is always its own).
- A headless build resolves scopes for **its** project, not the active one: `AXF_BUILD_PROFILE` already pins the
  profile for one process, and `projectOfProfile` gives the project. `deploy/claude-headless.sh` and
  `deploy/claude-login.mjs` read the account set through this (new `--project <id>`, default from the pinned profile),
  so switching the active project never re-points a running build.

### Changes (`applyChange`)

| Change | Effect | Log line |
|---|---|---|
| `{ action: 'own', id, scope, from? }` | Adds `scope` to `owns`, sets `ownedAt[scope]`. Returns `copy: { scope, from }` for the IO side: `from` is `'shared'` (default) or another project id whose own copy is used as the seed. Already owned → no change, no error. | `project <id> now has its own <scope> (copied from shared)` |
| `{ action: 'share', id, scope }` | Removes `scope` from `owns`. The own copy stays on disk. Returns `release: { scope }` so the IO side can note the path. Not owned → no change. | `project <id> shares <scope> again (its own copy stays in …/projects/<id>/)` |
| `{ action: 'create', …, from?, carry? }` | **Clone.** `from` = source project id (default: the active project; `null` = plain empty project, today's behaviour). `carry` = `'all'` (default) or a list of scopes. For each carried scope: if the source *shares* it, the new project shares it too (same effective values, nothing copied); if the source *owns* it, the new project owns a copy of the source's own data (`copy: { scope, from: source.id }`). `repo` and `hub` are copied as pre-fill; the wizard's repo step lets you keep or change them (s5). `clonedFrom` is recorded. Builds, notes, to-dos, tasks, lists and plans are **never** carried: the new build profile starts empty, exactly as today. | `project "<name>" created from <source> (carried: …; builds, notes, to-dos and plans start empty)` |

Every change goes through `act` in `framework/cli/projects.mjs`, which performs the copies (`copyScope(scope, from, to)`
per store, 0600 for secret files, under the builds-store style lock) before saving the registry, so the registry never
says "own" while the folder is missing. `copyScope` for `claude-accounts` writes `accounts.json` with the source's
members, active and routing; for `credentials` copies `secrets.env`; for `plugins` copies each plugin's settings files
plus `plugins.json`; for `console` and `hub` the hub documents through the same hub client lib-hubsync uses.

## What the user sees

One place: **Settings → Plugins → Projects** (the project-switcher tab) gains a *This project owns* panel for the
active project (and for any project picked in the list): five rows, one per scope, each a framework `Switch` labelled
**Shared with every project** / **This project's own**, a sub-line saying where the values come from
("shared · same as AmberX AXF" or "own · copied from shared on Nov 13"), and on own rows a **Copy from…** menu (shared or
another project) to re-seed. Flipping to own asks nothing (it only copies). Flipping to shared confirms once ("Keep its
own copy on disk; the project uses the shared <scope> from now on"). The base project shows the panel read-only with the
note "AmberX AXF is the shared set".

Each affected screen shows the same fact where the values are edited: a small `fx-chip` in its level toolbar on
**Claude accounts**, **AI keys**, **Systems check → Credentials**, **Claude**, **Plugin switches**, **axHub sync** and
Settings → Look: *Shared with every project* or *This project's own*, tap opens the Projects panel on that row. Nothing
else on those screens changes; they read and write through `scopeDir` and otherwise behave as today.

The **New project wizard** (PR #529, step s9) already shows the current project's values greyed out with a checkbox to
unlock each; `from` and `carry` feed it: unlocking a step and choosing differently makes that scope *own* on the new
project with the chosen values; leaving it locked carries it as described above.

Every colour, size and spacing comes from `--fx-*` tokens; controls are framework `Switch`, `Button`, `SelectField`,
`fx-chip`; checks `check-theme.mjs`, `check-controls.mjs`, `check-toolbars.mjs` run in CI.

## API (the same four ways)

| Action | CLI (`framework/cli/projects.mjs`) | REST (`/plugins/project-switcher`) | MCP / voice |
|---|---|---|---|
| Read what a project owns | `projects.mjs owns [<id>] [--json]` → `{ owns, ownedAt, where: { <scope>: path } }` | `GET /owns?project=` | plugin command `project-switcher.owns` ("what does this project own") |
| Give a project its own copy | `projects.mjs own <id> <scope> [--from shared\|<id>]` | `POST /own { project, scope, from? }` | `project-switcher.own` ("give this project its own credentials") |
| Share again | `projects.mjs share <id> <scope>` | `POST /share { project, scope }` | `project-switcher.share` ("share Claude accounts again") |
| Clone | `projects.mjs new "<name>" [--from <id>\|none] [--carry all\|a,b]` | `POST /new { name, from?, carry? }` (existing route, new fields) | `project-switcher.new` ("new project Garden from this one") |
| Open the panel | `axf.mjs focus console-web /settings/plugins/projects` | `console_open` target `settings/plugins/projects#owns[.<scope>]`; action `projects.owns` | `console_show projects.owns` |

`GET /` and `GET /current` include `owns` and `where` for every project. The plugin's `commands.items` list the three new
routes with `readOnly` / descriptions so plugin-commands exposes them to MCP and AmberX unchanged. The console server's
mirror (`projects.py`) reads `owns` and offers `cx.scope_dir`; it never writes the registry (one writer, the Node CLI).

## Effects on existing stores (steps s2 to s5, in order of risk)

1. **credentials.py**: `init(root)` loads the shared vault into the environment at start as today; `cx.scope_dir` picks
   the active project's file for reads and writes, and a project switch reloads the environment from the new file
   (`STORE.reload()`); subprocesses the console starts inherit the right set. Builds get theirs through
   `claude-headless.sh` sourcing `secrets.env` resolved for the build's project.
2. **Claude accounts / AI keys / worker-routing / claude-login / claude-headless**: read the set (`accounts.json`) for
   the project in force; `claude-account list` gains `--project`; the one-account picker build
   (`one-account-picker-…`) picks *within* the project's set and stores the pick in it. The dispatcher plans
   `planned.account` from the build's project's set.
3. **Plugin settings**: a `cx.settings_path(folder, name)` / `rt.settings` helper that applies `scopeDir(…, 'plugins')`;
   plugins switch to it one at a time (grep for `dataDir` settings files); the enabled set and Claude settings follow.
4. **Console look and settings** (`console` scope) and **hub connection** (`hub` scope): lib-hubsync gets the project in
   the document path; `persistRoot()` honours `project.hub.project` when owned.
5. **Clone + wizard pre-fill** (s3, s5), then tests (s4): `check-projects.mjs` gains own / share / clone cases: base can't
   own; own copies then diverges (a change in shared does not reach the own copy); share keeps the folder; clone from a
   sharing source shares, from an owning source copies; clone never carries builds, notes, to-dos or plans; a pinned
   `AXF_BUILD_PROFILE` resolves to its own project's set while the active project is another.

## Decisions taken here (say so in the PR)

- **Opt-in per scope, not all-or-nothing.** Brett asked for both "own everything" and "don't make the project have to";
  five independent switches give both.
- **Copy on flip, no live fallback.** An own vault or own set is complete on its own; a missing key fails loudly in that
  project instead of quietly using another project's secret.
- **Accounts are a membership set over logins stored once**, to keep token refresh correct.
- **One folder rule** (`<shared>/projects/<id>/`) for every scope, including hub documents, so a reader that knows the
  shared path can always find the own one.
- **Base project = the shared set**; `migrate` moves nothing.
