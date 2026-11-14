# Hotfix: toolbar settings still change nothing

## s1 — Reproduce

The live console (https://console.amberxai.com) answers 401 to this build session (no console token on the VPS build
runner), so the repro runs main's own runtime (the code the live console is built from, `a690b2954`) headless:
set every field of the toolbar settings dialog on the app toolbar (`axf.chrome.toolbar.app`), then compare what the
toolbar renders from (compiled root style + toolbar data + fold state).

| Field | Value saves | Toolbar redraws |
|---|---|---|
| Buttons (variant) | yes | **no** |
| Align | yes | **no** |
| Size (density) | yes | **no** |
| Surface | yes | **no** |
| Rule between groups (divider) | yes | **no** |
| Search box (showSearch) | yes | **no** |
| Collapsible | yes | **no** |
| Tap to confirm | yes | n/a (behaviour, read by tapconfirm.ts; works) |

Every value is stored; nothing the toolbar draws reads it.

## s2 — Which earlier PRs landed, and the real break

| PR | What | State |
|---|---|---|
| #622 per-instance-settings-window-picker | picker of which settings interface a toolbar's dialog uses | merged Nov 13 |
| #642 per-instance-settings-picker-merge-main | merge of #622 | merged Nov 13 |
| #650 per-toolbar-settings-fix-failing-chrome | fixture fix + land the per-instance interface | merged Nov 13 |
| #625 chrome-settings-actually-apply-toolbars | **the fix that makes the values apply** (`rt.chromeData`) | **still open**: its light checks failed, it went stale, nothing re-queued it |

The merged three only changed which dialog opens and what it saves. The renderers never read what it saves:

- `Chrome.tsx` `Toolbar` / `AssetToolbar` draw from the raw toolbar asset (`useAsset('toolbar').data`), never
  `axf.chrome.toolbar.<instance>`.
- `runtime.compileStyles()` feeds `toolbarStyle(this.asset('toolbar').data)`: density, surface and divider attributes
  ignore the override; `styleSettingsKey()` doesn't include it, so the root style never re-applies.
- Workspace (plugin) toolbars (`libs/workspace`, `axf-ws-toolbar:<workspace>`) read only their own `labels` flag; no
  PR ever wired them to their settings dialog.
- Only `TabGroup.tsx` folds the instance override in, which is why tab-group settings work and toolbar settings don't.

## s4 — Landed and verified on the live console

- PR #673 merged through the queue Nov 14, 17:36 UTC (`c3e5b59d7`).
- The live console (`axf-console`, restarted 22:38 UTC) runs `d465d20c0`, which contains the merge. Its served bundle
  (`/opt/axf-console-dist`, built 22:37 UTC) carries the fix: `chromeData("toolbar")` and the other chrome kinds are
  compiled in.
- `framework/spec/check-chrome-apply.mts` run on the deployed revision `d465d20c0`: 174 checks pass. Every toolbar
  settings value changes what the app toolbar, page toolbars and workspace toolbars draw, per instance, and survives
  a reload.
- Not done: a click-through in a real browser on console.amberxai.com. The console starts only after axHub answers
  with a signed-in session, and this build runner has no axHub login (same 401 as s1). A headless browser against
  the container's own port stops at "Waiting for axHub".
