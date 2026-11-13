# Claude badge = can Claude build

Build `claude-badge-can-claude-build-green-when`, phase 1 (Opus), branch
`claude/claude-badge-can-claude-build-green-when`.

## Result

- **Claude badge** (`badge/claude`) now answers "can Claude build?": green when one build account or more is ready, red when
  none is, grey when the orchestrator can't be read. It shows `Claude 1/4` (ready of all).
- **Ready** = the dispatcher may put a build on the account (a worker it uses, or an API account it may route to) **and** the
  orchestrator's latest account health sweep says it signs in and has credits. One function decides it:
  `buildReady()` in `apps/console-web/plugins/build-orchestrator/pipeline-core.mjs`, built on the same `accountView()` the
  dispatcher plans with. A sweep that is over a few rounds old (`freshHealth`) counts as not ready.
- **No VPS root login any more.** The badge plugin no longer calls `axf.claude-accounts@1` (`claude auth status`),
  `axf.ai-keys@1` `limited_at` or `active_account` (`.active`). The VPS badge now says whether the console can see the build
  accounts on the host: green when read live or from a host snapshot under 10 minutes old, amber when the snapshot is older,
  red when there is nothing to read.
- **Tap shows which accounts are ready.** The Claude badge drops down by default: every build account with Ready / Not ready,
  why not, whether it takes Fable, and when it was last checked; Refresh reads again. The same list is in Settings → Plugins →
  Badges → Can Claude build. Account names go only to the owner.
- The old load-time AI test (a few tokens on every console load) no longer runs. It is now **AI assistant test** in the settings,
  run only on demand.

Live on this VPS at build time: 1 of 4 ready (`mossesx-max-`). `account-3` is not a worker, `account-5` is switched off as an
API worker, `mossesx-api` is not in the pipeline's API account list.

## How each part is reached (API)

| What | REST | MCP / CLI (plugin-commands) | Console action (deep link, voice) |
| --- | --- | --- | --- |
| Can Claude build, per account | `GET /api/plugins/claude-badge/build?refresh=1` | read `claude-badge` build | `claude-badge.ready.open` opens the list |
| Read it again | `GET …/build?refresh=1` | same | `claude-badge.ready.refresh` |
| VPS badge | `GET /api/plugins/claude-badge/vps` | read `claude-badge` vps | `claude-badge.tap.vps` |
| The orchestrator's read | `GET /api/plugins/build-orchestrator/pipeline/ready` | read `build-orchestrator` pipeline/ready; `node …/pipeline.mjs ready [--json]` | — |
| Service | `axf.build-dispatch@1` `ready()` | | |
| AI assistant test | `POST /api/plugins/claude-badge/test` | command `claude-badge` test | Settings → Badges |

Badge settings (show, Icons only, label, side, order, tap, icons) are unchanged and remain settings keys reachable through
control@1.

## Decisions (headless, nobody to ask)

- "Claude badge" is the `console` badge labelled Claude. The VPS badge kept its slot but lost the root-login read, as asked.
- API accounts count as build accounts only when the dispatcher may route to them (`api.usable`), because that is when the
  dispatcher would put a build there.
- Busy accounts (all slots taken) still count as ready: they take the next build.
- The Claude badge's tap default moved from "open settings" to "drop-down". Anyone who picked a tap themselves keeps it.
- The server caches the read for 30 s (Refresh reads again, at most every 5 s); the orchestrator read takes about 0.6 s.

## Checks

- `python3 apps/console-web/plugins/claude-badge/test.py`: 78 passed (new: green / red / grey, cache, owner-only names, VPS
  badge states, no root-login read left in the source).
- `npx -y tsx apps/console-web/plugins/claude-badge/test.mts`: 55 passed. `banner.test.mts`: 48 passed.
- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 46 passed (new `buildReady` test).
  `test.mjs` 33, `test.py` 41 passed.
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`, `check-plugin-pages`, `plugin-commands check`: pass.
  `plugin-lifecycle check claude-badge` flags only the gitignored `.axf-focus.json` the focus command writes locally.
- `tsc --noEmit` for console-web: clean.

## Screenshots

`shots/claude-badge-ready-desktop.png`, `shots/claude-badge-ready-phone.png` (this branch's console, offline look, the
drop-down open over the real account health sweep). Sent to UI Review.

## Left

- Brett's UI Review click, then the merge queue lands it.
- No Android twin: the badge is console-only.
