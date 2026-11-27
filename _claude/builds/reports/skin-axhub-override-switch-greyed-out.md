# Skin from axHub: Override switch, greyed-out editors with notes

Build `skin-axhub-override-switch-greyed-out`, phase 1 (Opus), PR #641, branch `claude/skin-axhub-override-switch-greyed-out`.

Brett (Nov 13 2026): "under 'inherit from axHub only' there'll be an override switch; clicking it automatically turns off axHub mode, you only have one or the other; every screen where you'd change properties is greyed out with a note saying you can't edit this, but click here if you insist, and it will no longer refresh and inherit its data from axHub"

## Result
- Settings → Appearance → Skin source has a new switch, **Override axHub** (`axf.lock.hubskin.override`, off by default), under "Get my skin only from axHub". The two are mutually exclusive in the runtime, whichever path sets them.
- While axHub-only is on, these editors are disabled, not hidden, under the lock note:
  - Appearance panel, skin picker, every-asset picker and plugin themes (locked since #618)
  - Theme manager (UI Manager rows), Theme editor, Asset studio, nav style settings and the context menu designer (`HubSkinLockArea`, new here)
- The note uses Brett's wording and has a "Click here to override" link. The link and the switch both ask once.
- Edits made under Override are recorded in `axf.lock.hubskin.overridden` and show as Overridden chips plus a summary note. Turning axHub-only back on clears them.
- API: action `appearance.hubskin.override:on|off|toggle`, setting through control@1 `console.settings`, and voice "override the axHub skin" / "stop overriding the axHub skin" (Python twin included).

## Depends on
- #618 (`console-skin-axhub-only`) is merged into this branch. Land it first.

## Checks
- `check-appearance-lock.mts`: 40 checks (13 new)
- `check-skin.mts`: 395
- `check-theme`, `check-controls`, `check-toolbars`, `check-console-control` and the control inventory: pass
- `tsc`: clean
- The Python voice twin matches the fixture
- Checked in vite preview on desktop and phone (lock note, confirm, mutual exclusion, unlock)

## Open
- UI Review item `r-20261113-ggspz01` is stored in this worktree only: the session had no `AXF_CONSOLE_URL` / `AXF_TOKEN`. Re-send with `--console` from a session that has them, or take new shots.
- Not checked on screen: the Theme manager view (it didn't load in the mocked preview).
- Not built: Override with per-asset inheritance (unedited parts keep following axHub). Override means the app's own look.
- Kotlin twin deferred (PORTING.md).
