# Open any website by voice on the phone, optionally with the AmberX recorder running

Build `open-any-website-by-voice-on-the-phone-optionall` · Phase 1 (Opus) · Nov 12 2026 · branch
`claude/open-any-website-by-voice-on-the-phone-optionall`. Supersedes `amberx-open-any-url` and `amberx-open-any-url-apk`.

Brett said (2026-11-10 20:46): "I need to be able to tell you to go to any website and open the web browser with the
recorder in AmberX, or in a plugin somewhere."

## What shipped

**AmberX (phone): "go to <any website>"**
- `apps/amberx-droid/src/plugins/web/web/core.ts` `parseGoTo`: reads "go to example.com", "go to example com" (the
  recognizer drops the dot), "example dot com", "bbc co uk slash news", "amber x ai com", a full https URL, and
  "go to website wikipedia" (a feeling-lucky search). Only http(s) comes out; javascript:, file:, data:, intent:,
  chrome: are refused. "go to notes" / "open inbox" are not websites, so app pages still open as before.
- Recorder: "… and record it", "… with the recorder", "record <site>" start the Audio Output Recorder first (by its
  action `output-recorder.start`, configurable, never by folder), wait for Android's consent screen, then open the
  page. A recorded open is also a note in the Web list (URL + time, synced to axHub) next to the recording's
  timestamped parts.
- Opening: on the phone the page load is handed to the phone's browser by the Capacitor shell (any host but AmberX's
  own), in front; in a desktop browser it is a new tab.
- Audit: every open is logged (setting `amberx.web.log`, newest 100; Web page → Opened; clear with
  `web.go-log-clear`), plus a terminal line.
- Voice seam: `globalThis.amberxVoice.route(module, fn)` (voice plugin) lets a plugin read whole sentences; the Web
  plugin uses it. Switch: Settings → Plugins → Web → "Go to <website> by voice".
- UI: Web page gains "Open in browser", a "Record while it is open" switch and the Opened list.

**Console / Molly: Web browser plugin** (`apps/console-web/plugins/web-browser`, new)
- An embedded browser pane (view `web-browser`): address bar, the page in a sandboxed frame, Reload / Open in a new
  tab / Close, Recently opened. The pane follows the server state, so an open from REST, MCP, the CLI or a Claude
  session lands there too. Molly hosts the console, so it is there as well.
- Server: `GET state`, `POST open {url, show?, record?, by?, reason?}`, `POST close`, `GET log`. Any http(s) host;
  other schemes, credentials in the URL and spaces are refused (422). Every open and close goes to
  `.axf-console/plugins/web-browser/audit.jsonl` with by / via / reason. `show` (default on) brings the open console to
  the pane through console-commands@1. Capability `web-browser@1`.

## How each part is reached (API rule)

| | Phone (AmberX Web) | Console pane (web-browser) |
|---|---|---|
| Deep link | `nav:web` | `nav:web-browser`, console_open screen `web-browser` |
| State | setting `amberx.web.log` | `GET /api/plugins/web-browser/state`, `log`; MCP/CLI `web-browser state` / `log` |
| Actions | `web.go:<url>`, `web.go-record:<url>`, `web.go-log-clear` | `POST open` / `close`; actions `web-browser.open:<url>`, `.close`, `.show` |
| MCP / CLI | plugin commands (auto) | `axf web-browser open --url example.com`, `close`, `state`, `log`; same as MCP tools |
| Voice | "go to example.com", "… and record it", "record example.com" | tell Amber in a Claude session ("go to example.com"): she calls the MCP tool / CLI |

## Tests

- `npx tsx apps/amberx-droid/test.mjs`: 2345/2345 (adds go-to parsing, schemes refused, recorder phrases, log cap).
- `python apps/console-web/plugins/web-browser/server/test_web_browser.py`: 29/29 (wired into CI, android.yml).
- `tsc --noEmit` clean in apps/amberx-droid and apps/console-web.
- check-theme, check-controls, check-toolbars, check-chrome-assets: pass. Plugin commands: web-browser 4 reads, 5
  commands; plugin-commands runner test 41 checks. Lifecycle check: clean.

## Deferred (no new Android work; framework/spec/PORTING.md)

- axHub `amberx.open_url` / AXPP `browser.open` still only opens amberxai.com (`OpenUrlRules`): a Claude session can't
  yet open another host on the phone remotely; it opens in the console pane instead.
- Chrome pinned by package, background starts (wake word with AmberX off screen), and the URL as the recorder's
  session name need native bridge additions.

## Notes

- UI Review shots not taken: the headless console capture stops at "Waiting for axHub" (the capture browser cannot fetch axhub.amberxai.com). Needs a run with a reachable hub.

- `plugin-lifecycle check` flags the gitignored, auto-written `.axf-focus.json` when it names a plugin file; it is not
  in the repo, so CI is unaffected.
