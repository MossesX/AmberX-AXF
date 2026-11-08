<!-- memory-chunk@1 source=_claude/memory/docs/harvest/android-security.md lines=38-44 tokens=140 -->
## Contracts / fixtures
No cross-port engine changed, so no fixtures (gen-fixtures leaves `spec/fixtures` unchanged). New Android-only contracts:
`AxfUiPoints.VIEWS` (`axf.views`, `ViewContribution`; the web port already has `AxfWebLibrary.views`), manifest
`android.secureWindow` and `app.about` (plain JSON keys; the web `AxfManifest` type has no `android` block, so nothing
to mirror there), `LockModule(context, wording, defaultMode)` (**signature change**: the Application is now the first
parameter; `library.json` install line is `LockModule(this)`).
