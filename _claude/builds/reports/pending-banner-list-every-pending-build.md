# Pending banner — report

Build `pending-banner-list-every-pending-build` · branch `claude/pending-banner-list-every-pending-build` · Opus, one
headless session · Nov 16 2026.

Brett said (Nov 16 2026, 19:16): "I need a pending banner that lists all the pending things and lets me send everything
to the queue right from the banner."

## What changed

New console plugin `apps/console-web/plugins/pending-banner` (`ai.amberx.axf.console.pending-banner`, enabled by default).

- **The banner** (BannerDef `pending`, label *Pending builds*, icon clock, settings tab `pending-banner`): shows only while
  builds wait in the orchestrator's Pending tab. Head row: a count badge, "N builds waiting in Pending · K fell back", a
  select-all checkbox, the bulk moves for ticked rows (Queue N, Hold N, Archive N) and **Send all to Queue**. One row per
  build: title, what it does in plain words (Brett's own words when the build has them, else the first sentence of its
  detail), priority chip, steps done / total, and why it is in Pending, with **Queue**, **Hold**, **Archive** and **Open**.
- **Why it is in Pending:** *fell back* (warning colour) when the build ran before: the last run's outcome, account and
  steps left plus the orchestrator's latest note about it (back to Pending, reconciler pause, session ended…), or "Stopped
  with N of M steps done" when there is no note; otherwise *new*.
- **Hold** on a Pending build = into the Queue on hold (the dispatcher's hold only applies to queued builds): it keeps its
  place and nothing starts until released in the orchestrator. **Archive** asks first (behaviour theme confirm) and is
  restorable from the Archive tab. **Open** focuses the build in the orchestrator.
- **Launches expanded** (`useBannerLaunchOpen`); collapsed keeps the head row and the first three builds.
- **Joins the one Banners settings** through `label` / `icon` / `settingsTab`; its own tab is Settings → Plugins →
  Pending banner (status, Check now, link to the Pending tab, lifecycle).
- **AmberX push when a build lands in Pending:** a server thread checks every minute and raises one alert per build new
  in Pending (`source: pending-banner`, key `pending-banner:landed:<id>`, warning when it fell back, info when new; link
  opens the build). Registered in `notify.json` as `pending.landed` (push, high priority) so the Notifications panel
  controls it. The alert resolves when the build leaves Pending (moved from the banner or anywhere else). The first check
  after an install only records what is there, so installing never buzzes the phone with the whole list.
- Every move goes through the dispatcher CLI (`build-orchestrator/pipeline.mjs queue | hold | archive`), so the banner,
  the orchestrator, the CLI and MCP share one set of rules and one store. Many ids at once; one refused build never stops
  the others (`{done, refused}`).

## API (how each part is reached)

| What | REST (`/api/plugins/pending-banner`) | MCP / CLI | Console control / voice |
| --- | --- | --- | --- |
| Read the list | `GET /list[?fresh=true]` | plugin command (auto, plugin-commands@1) | `pending-banner.check` |
| Open (deep link) | — | `console_open` → action | `pending-banner.open` (expands the banner), `pending-banner.open:<id>` (the build) |
| Queue | `POST /queue {ids}` | plugin command | `pending-banner.queue:<id,id>` |
| Send all to Queue | `POST /queue {all: true}` | plugin command | `pending-banner.queue-all` |
| Hold | `POST /hold {ids, why?}` | plugin command | `pending-banner.hold:<id,id>` |
| Archive | `POST /archive {ids, why?}` | plugin command | `pending-banner.archive:<id,id>` (destructive: confirm) |
| Landed check now | `POST /check` | plugin command | — (runs every minute) |

`node framework/cli/plugin-commands.mjs check pending-banner` → 3 reads · 10 commands. Every button has its own
console-control address (`button:pending-queue-<id>`, `button:pending-queue-all`, `button:pending-banner.toggle`, …) and
each row is `row:pending-banner/<id>`; `src/control/inventory.json` regenerated.

## Checks

- `python3 apps/console-web/plugins/pending-banner/test.py`: 36 checks pass (list shape, what / why, refusals, queue many,
  hold, archive, Send all, landed notices, seed-without-buzz, resolve on leave, manifest / banner / actions).
- Read-only smoke against the live builds store: 22 Pending builds listed with priorities and steps. It found a real bug
  the mocked test could not (repo root one level short), fixed in s2.
- `check-theme` ✓, `check-controls` ✓, `check-toolbars` ✓, `check-chrome-assets` ✓, `notify-control/test.py` 133 ✓,
  `tsc --noEmit` clean for the plugin.
- `check-console-control`: the only finding is a tab group in `plugins/claude-settings/web/index.tsx:234`, already on
  main and not from this build.
- `plugin-lifecycle check pending-banner`: its only finding is the gitignored live-focus file `.axf-focus.json` that
  `axf focus` writes in the worktree. It is not present in CI.

## Not done / follow-ups

- **No screenshots.** This session did not build the console or run Playwright. Before/after shots and the
  UI Review choices (ui-choices@1, three looks) are still to do. The look follows the approvals banner, using tokens only.
- **The older pending list** (`framework/cli/pending.mjs`, pending@1) is a separate view and lags the orchestrator. For
  example, it shows builds as Pending that the store has running. The banner follows the orchestrator's Pending tab,
  because that is the tab the dispatcher queues from.
- **Tie-in with `alert-every-time-build-falls-back-to`:** a note was left on that build. A fall-back can raise the
  dispatcher's "Back in Pending" alert and this notice. Fold them when that build lands (reuse the key or skip one).
- Kotlin / AmberX native: none needed. AmberX gets the push through the alert hub. No engine changed, so there is no porting gap.
