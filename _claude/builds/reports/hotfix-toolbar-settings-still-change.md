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
