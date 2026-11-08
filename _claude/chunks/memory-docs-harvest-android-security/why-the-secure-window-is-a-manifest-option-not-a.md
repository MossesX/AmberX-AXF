<!-- memory-chunk@1 source=_claude/memory/docs/harvest/android-security.md tokens=149 -->
### Why the secure window is a manifest option, not a build option
`framework/schemas/build-options.json` options each write an **asset token** that both ports' engines read (e.g.
`wrapGroups` → `--fx-wrap-groups`). FLAG_SECURE is not visual and has no web meaning: it's a property of the Android
window and the process (WebView debugging). Putting it in a theme asset would let a theme swap or a roll turn a
security flag off. So it's an app option in `axf.manifest.json` → `android.secureWindow` (read by the kernel's
`AndroidManifestInfo`), overridable in code (`AxfActivity.secureWindow`).
