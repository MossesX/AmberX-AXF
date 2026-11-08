<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/windows-terminal-fable.md lines=123-136 tokens=265 -->
## Known gaps

- **Android twins deferred** (`framework/spec/PORTING.md`): `contract/Windows.kt` fields + functions and the
  `windows.json` replay, the Compose window host's 8 handle hit areas, caption buttons, frameless slot and snap preview
  layer; Kotlin `SettingsUiEngine` levels + visible sets, lib-settings level toolbar and level editor replaying
  `settings-ui.json`. Android work is on hold (rule), Brett finishes that side.
- Snap zones are the Windows set (halves, quarters, top = maximize); no user-defined zone layouts yet (`SnapRules` is the
  seam).
- The Terminal's caption buttons live in the plugin; other frameless content has to wire `useWindowFrame()` itself.
- `rebake.mjs status` reported every app as "edited" before this step because CI re-bakes without rewriting
  `axf.lock.json`; the locks are rewritten now, but a CI bake will drift them again until CI calls `rebake.mjs apply`.
- No Android screenshots: the rebuild branch is not named `fable/` / `rebuild/`, so `rebuild-shots.yml` did not run, and
  no Android code changed.
