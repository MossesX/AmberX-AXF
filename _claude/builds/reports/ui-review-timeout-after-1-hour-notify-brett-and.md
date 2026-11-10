# UI Review timeout: after 1 hour, notify Brett and go ahead (`ui-review-timeout-after-1-hour-notify-brett-and`, Opus)

**Brett said (Nov 10 2026):** "Does UI review hold shit up? If shit sits in UI review for more than an hour, send me a
notification and just go."

## The answer: yes, it did

UI Review held a build up in three places, and before this build none of them had a time limit:

| Gate | What waited | Now |
|---|---|---|
| Merge hold (`ui-review@1` `holds()`, read by the push banner and the merge queue) | a PR with a waiting UI Review item never landed | after 1 h the item is approved, the hold lifts, the PR lands |
| Option pick (`ui-choices@1`) | a build waited for Brett's pick before building the picked views | after 1 h the recommended (first) option is picked |
| Predicted look (`ui-prediction@1`, only with "wait for my look approval" on) | the build did not start | after 1 h the look is approved, the build starts |

The "how many options" question already timed out to the default (5 min) and is unchanged. Ask changes / Reject still
hold: those are Brett's own decisions, not waiting.

## What changed

PR #343 (the Nov 4 review alarm: 30 min, loud alarm, 5 min grace, approve-or-hold switch) never landed. This build
brings in its server timer, REST/MCP/CLI and settings panel and **upgrades** it into the timeout instead of adding a
second timer. The loud alarm, grace and hold switch are gone: builds never sit blocked.

- **Timer** (`apps/console-web/plugins/ui-review/server/alarm.py`, `ui-review-alarm@1`): every waiting item gets a
  60-minute timer (adjustable, 1 to 1440 min). Ticker every 30 s. The clock starts at the later of submit and when
  the timeout was first on, so items already waiting get a full hour. Plain code, no model.
- **At the timeout**: the phone gets "UI Review: <build> waited 1 h, going ahead with <option>" (alert@1, source
  ui-review, AmberX shows it, a tap opens the item's group). The item is approved with the recommended option (the
  first one the build ships), or simply approved when there is one option or none, marked "auto-approved after
  timeout" in its history.
- **Logged** on the item, in the fix log (`axf.changes@1`, kind fix), in Activity Monitor (`axf.activity@1`) and in
  the Breakroom chat (`axf.crew@1` `say`, brought in from #343).
- **Brett changes it afterwards** (another option, Ask changes, Reject): a follow-up build is filed through
  `axf.build-dispatch@1` and the item records its id. One follow-up per auto-approval. Undo (re-open) restarts the
  clock and files nothing.
- **Per item**: Snooze (more time), Go now, Undo.
- **Settings** → Plugins → UI Review → Review timeout: on/off, timeout, phone notification, follow-up builds, scope
  (every item / only items blocking a merge), open UI Review on new items; the last auto-approvals with Undo.

## API (every surface the same)

| | REST (`/api/plugins/ui-review/…`) | MCP (plugin-commands@1) | CLI (`review.mjs timeout …`) | Voice (AmberX, via the MCP command descriptions) |
|---|---|---|---|---|
| status | `GET alarm` | `alarm` | `timeout` | "when does UI Review go ahead" |
| settings | `GET`/`PUT alarm/settings` | `alarm-settings`, `alarm-settings-set` | `timeout set timeoutMin=120` | "give UI Review two hours" |
| snooze | `POST alarm/snooze {id, minutes}` | `alarm-snooze` | `timeout snooze <id> [min]` | "give that review another hour" |
| go now | `POST alarm/go {id}` | `alarm-go` | `timeout go <id>` | "just go with it" |
| undo | `POST alarm/undo {id}` | `alarm-undo` | `timeout undo <id>` | |
| run now | `POST alarm/tick` | `alarm-tick` | `timeout tick` | |

Deep link: the phone notification opens UI Review on the item's group (`?axf-review-group=`); the settings panel is
Settings → Plugins → UI Review → Review timeout.

## Tests

- `python apps/console-web/plugins/ui-review/test.py`: **281 checks ok** (timeout core on a fake clock; routes through
  the real store: go ahead, first option picked, holds lift, phone line, fix log / activity / chat, follow-up build on
  a changed pick and on Ask changes, snooze, go now, undo, off; the predicted-look gate and the merge hold both let go).
  Fixed on the way: the choices-assets check counted the option assets the repo ships (failed on main too).
- `tsc --noEmit` (console-web) clean; `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets` pass;
  agent-swarm `test.mjs` 100 checks.
- `plugin-lifecycle check ui-review` reports 6 stale references in files outside this build (glossary, demo
  fixtures, `shipped.mjs`, `.axf-focus.json`); unchanged by this build.

## Not done / decisions

- **Screenshots / UI Review submission of the settings panel: not done.** The headless console capture
  (`rebuild-shots.mjs`) stops at "Waiting for axHub" (the browser can't reach axhub.amberxai.com from the capture
  sandbox), and the VPS Playwright install is out of step with its browser (1.56 wants chromium 1194, the cache has
  1234). The panel is a Settings sub-panel built from framework controls only (Switch, Slider, SelectField, Button,
  Note).
- **"Recommended" = the first option.** Builds list options in order of preference. An explicit `recommended` flag
  would be a ui-choices@1 contract change (Fable) and is left out.
- **PR #343** keeps its list addenda (sort/group by PR, ids, deep links `?item=`), which are not in this PR because
  main has reworked the list since. Its alarm part is superseded by this PR; #343 needs a rebase after this lands.
- The VPS disk hit 100% during this build (193G); about 7G free afterwards.
