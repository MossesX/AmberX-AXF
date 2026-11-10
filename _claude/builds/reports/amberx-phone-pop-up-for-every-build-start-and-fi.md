# AmberX phone pop-up for every build start and finish

Build `amberx-phone-pop-up-for-every-build-start-and-fi` · Opus · branch `claude/amberx-phone-pop-up-for-every-build-start-and-fi`

## Brett said (verbatim, Nov 10 2026 02:18)

> I want a notification on AmberX every time the orchestrator starts a build and every time a build finishes. I want it to pop up on my screen and say what build is starting or finishing and what account it's being run on. On my phone.

## What changed

There is no new channel. The dispatcher already raised `pipeline.launched` and `pipeline.ended` alerts, but they never reached the phone as pop-ups, for three reasons:

1. **Start was muted on AmberX.** `notify.json` set `pipeline.launched` to `channels.amberx: false`. Now it has `push: true` and `priority: high`, so it shows as a heads-up on AmberX's high-importance Console alerts channel.
2. **The alerts API rejected every one of these alerts.** The link was `#/build-orchestrator`. `POST /api/alerts` only accepts `http(s)://`, `view:` or `settings:` links, so the request got a 400, and the dispatcher's curl swallowed the error. Start and finish now link to `<console>/?axf-action=build-orchestrator.open-build:<id>&orch-build=<id>`, and the other kinds use `view:build-orchestrator`.
3. **Retries and reruns didn't pop up again.** One key per build (`pipeline:run:<id>`) only bumped a count, and AmberX doesn't buzz twice for the same key. The keys now include the run number: `pipeline:run:<id>:<run>` and `pipeline:end:<id>:<run>`.

What the phone shows (AmberX prints `<meta.label>: <title>`):

- `Started: <build title> on <account label> (<model>)`. The account label comes from claude-workers@1 and falls back to the account name. API-key runs add `(API key)`.
- `Finished: <build title> on <account>, <outcome>, <done>/<total> steps`. The outcome is one of: built / complete, failed, needs you, stopped and back in the Queue, or phase done with the next phase queued. When the build needs Brett, the text adds `Needs: <the session's last note>`.

Tapping the notification opens that build: the orchestrator page with the build's card on top.

The tap needed one generic console change. Plugin web parts load lazily, so a plugin's own URL check doesn't run on a cold start. A screenshot run showed the orchestrator wasn't loaded and the link landed on Home. The fix is `?axf-action=<action id>[:args]` (`apps/console-web/src/urlAction.ts`, wired in `App.tsx`): once the plugins are in, the console runs the named action and waits up to 30 s for a lazy plugin to register it. A lazy plugin's stand-in action loads the plugin and runs the real one. Only actions marked `effect: 'navigate'` run from a link, so a link can open a screen but can't change anything. It's checked by `apps/console-web/scripts/url-action-check.mts` (5 checks). It doesn't change any schema or plugin manifest.

Every start and finish is also one item in the Activity feed (`build-run:<id>:<run>`, running → done / failed). It goes through the `axf.activity@1` capability via the new route `POST /api/plugins/build-orchestrator/pipeline/activity`. Without the Activity plugin, nothing is logged there.

## Settings (defaults on)

These are in pipeline-settings@1 and on the **Build orchestrator → Pipeline → Phone pop-ups** card:

| Key | Default | Meaning |
|---|---|---|
| `notifyStart` | true | Pop-up on every launch (first run, retry, rerun, next phase) |
| `notifyFinish` | true | Pop-up on every session end |
| `notifySound` | true | Sent as `meta.sound` on the alert |
| `notifyGrouping` | `build` | `build`: a finish replaces its start, and a new run clears the last finish. `each`: every event stays |

On the AmberX side, the Notifications panel (notify-control) still controls the types `pipeline.launched` ("Build started") and `pipeline.ended` ("Build finished (built, failed or needs you)"): on/off, channels (banner, AmberX, sound, pop-up), priority and quiet hours. `pipeline.ended` is now linked to the Claude setting `notify.buildDone` instead of `notify.blocked`.

## API (how each part is reached)

- **Deep link:** `<console>/?axf-action=build-orchestrator.open-build:<id>` (any console page), `?orch-build=<id>` when the orchestrator is already loaded, or the action `build-orchestrator.open-build:<id>` (console_open / console_show, voice).
- **State:** `GET /api/plugins/build-orchestrator/pipeline/settings`; MCP / CLI `pipeline-settings`. The alerts themselves: `GET /api/alerts`.
- **Settings:** `POST /api/plugins/build-orchestrator/pipeline/settings` `{notifyStart, notifyFinish, notifySound, notifyGrouping}`; MCP / CLI `pipeline-settings-set` (plugin-commands@1); host CLI `node apps/console-web/plugins/build-orchestrator/pipeline.mjs set notifyStart=false`. Voice goes through the same MCP command.
- **Channels per type:** `notify-control set --type pipeline.launched --channel amberx --on true` (REST / MCP / CLI).
- **Activity line:** `POST /api/plugins/build-orchestrator/pipeline/activity {event, id, run, title, detail, state, url}`.

## Tests

- `pipeline.test.mjs` passes 36 checks. They cover alert wording, per-run keys, the deep link, grouping, and settings defaults. End to end, a real dispatcher tick in a sandbox sends `Started: Alpha feature on w-max (Fable)`. A crash sends a finish, and the retry pops up on its own key. A clean finish sends `Finished: … on w-pro, built, 1/1 steps`, and a stop with steps left sends `…, needs you, …`.
- `test.mjs` passes 33 checks, `test.py` 31, notify-control `test.py` 132 and activity `test.py` 142.
- `check-theme`, `check-controls` and `check-toolbars` are green, and the console `tsc --noEmit` is clean.

## Open / deferred

- **UI Review: no screenshots.** The headless browser sandbox on the VPS failed: hundreds of `ERR_NETWORK_CHANGED` errors and a blank page. The one clean run was before the link fix, so it showed Home. Nothing has been submitted to UI Review yet. The next session should run `rebuild-shots.mjs` with `--env AXF_APPEARANCE_HUB=off` on the link `/?axf-action=build-orchestrator.open-build%3A<id>` and submit with `--submit`. The PR isn't ready until then.
- **`lazy-loader-check.mts` already fails on main:** `shipped-features` paints the banner and isn't in `KNOWN_BANNERS`. Not touched here.

- **No real phone test yet.** The live dispatcher and console run main, so the new pop-ups only fire after this branch lands. Check after the merge: the next real start and finish should each pop up on the phone, and a tap should open the build.
- **AmberX sound and grouping on the phone.** The APK always posts on its Console alerts channel (sound per Android channel settings), and it doesn't group. Honouring `meta.sound: false` and `setGroup` is recorded as a deferred AmberX twin in `framework/spec/PORTING.md` (no new Android work). Grouping already works on the server side: a finish resolves its start, so the phone removes the start notification.
