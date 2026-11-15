# Token registry and Skin editor — phase 2 report

Build `token-registry-skin-editor-live-sandbox` · Opus · branch `claude/token-registry-skin-editor-live-sandbox` · PR #700
(phase 1 — registry, sandbox, chain, export, API — landed in #657).

Brett (2026-11-13): "list every token in a registry; any time a new UI is made add its tokens to the registry; an editor
that takes whatever UI you pick and throws it in a sandbox with live preview, hot render as you edit; a default skin;
every edit takes a snapshot, you see the chain of edits like a disk snapshot and can revert to any point; at any point
export current to a new skin"

## What phase 2 did

| Step | Result |
|---|---|
| s6 Default skin | Built-in `default` skin, locked: root of every chain, listed first in the skins library with a lock, `GET /skins/default` draws it over the console's own look; export over it and delete are refused (409). Engine `defaultSkinAsset` / `isLockedSkin`, Python twin, fixture. |
| s7 Snapshots | History shows every snapshot newest first with time, who/what made it and each token it changed (old → new). Click = preview in the sandbox (head unchanged; Revert to this / Back to head). Compare any two (A/B pickers, token-by-token diff). Engine `compareSnapshots` / `snapshotDetail`; routes `GET /sessions/{ui}/snapshots/{sid}`, `GET /sessions/{ui}/compare?a=&b=`. |
| s8 Export | Export current → new skin: name, description, SVG thumbnail in the skin's own values (`skinThumbnail`, unsafe values fall back), registered locally and queued for the axHub skin library (project `shared`, folder `skin-library`, table `skins`); the console page sends the queue with its hub session and reports back (`GET /hub`, `POST /skins/{id}/hub`, `POST /hub/{id}/result`, action `skin-editor.hub-send`). Exported skins leave out the slots a skin never sets, so they register anywhere. |
| s9 Restore | Restore previous edit (head's parent; a second press redoes) and Restore from axHub (default skin, no token edits) are new revert snapshots: toolbar buttons, `POST /sessions/{ui}/restore {to}`, `undo` kept as alias, deep links, voice. |

## How each feature is reached (UI, REST, MCP, CLI, voice)

Commands are plugin-commands@1 (`auto`), so each is REST `/api/control/skin-editor/<command>`, MCP `skin-editor_<command>`
and CLI `axf skin-editor <command>`. Deep links via `skin-editor.open:<…>` (console_open / console.actions).

| Feature | Deep link | Commands | Voice |
|---|---|---|---|
| Default skin | `skin-editor.open:snapshot:default` | `skins`, `skin` (id `default`), `revert {snapshot: default}` | "revert the skin to the default" |
| Snapshot preview | `skin-editor.open:snapshot:<id>` | `snapshot` | — (read via the command) |
| Compare | `skin-editor.open:compare:<a>:<b>` | `compare` | — |
| Revert | History → Revert | `revert` (id, minutesAgo, at) | "revert the skin to 10 minutes ago" |
| Export | Export tab | `export` (`hub: false` skips axHub), `hub`, `send-to-hub` | "export this as a new skin called Midnight" |
| Restore previous edit | `skin-editor.open:restore:previous` | `restore {to: previous}`, `undo` | "restore the previous edit" |
| Restore from axHub | `skin-editor.open:restore:hub` | `restore {to: hub}` | "restore the skin from axHub" |

## Checks

- `python3 apps/console-web/plugins/skin-editor/test.py` — all good (fixture replay incl. default skin, compare, thumbnail, restore; routes; voice).
- `node apps/console-web/plugins/skin-editor/test.mjs` — 11 checks.
- `node framework/spec/check-token-registry.mjs` — 322 tokens, fixture current.
- check-theme, check-controls, check-toolbars, check-chrome-assets, check-console-control (inventory regenerated), help-coverage --check, plugin-lifecycle check skin-editor, `tsc --noEmit` (no errors in the plugin or engine).
- Screenshots (desktop + phone, History with preview and Export with thumbnail) taken with `rebuild-shots.mjs` (appearance hub off) and sent to UI Review.

## Gaps and notes

- Sending to axHub needs a browser with an axHub session (the hub data server takes no console token). Headless/API-only exports stay `queued` until a console page is open; a failed send stays `failed` until `send-to-hub` re-queues it. The rows live on axHub, outside the plugin's data folder, so uninstalling does not remove them.
- The per-instance "Restore previous edit / Restore from axHub" in tab-group and grid settings (ChromeContext, component-tokens engine) is framework chrome and keeps its own per-instance history: the framework can't call into a plugin. Inside the Skin editor both buttons go through the snapshot chain.
- No Android/Kotlin twin (no new Kotlin work); the engine's Python twin is replayed against the fixture.
