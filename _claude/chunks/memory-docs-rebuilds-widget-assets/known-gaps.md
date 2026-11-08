<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/widget-assets.md lines=69-74 tokens=112 -->
## Known gaps
- Android "words on the page" provider (web `axf.text`) is not built: Compose has no DOM to scan; a `data-axf-search`-like semantics scan is a later step.
- Android `/` shortcut not taken at the root (see above); Ctrl/Cmd+K works with a hardware keyboard.
- Android settings anchors scroll to the group and filter by label; there is no flash animation.
- Android screenshots and the full Kotlin compile depend on CI (no Maven here).
