<!-- memory-chunk@1 source=_claude/memory/STATUS.md lines=228-228 tokens=172 -->
## xLayout host in Molly (Nov 3 2026, xlayout s4–s12, Opus; branch `claude/xlayout-opus`)

- Framework: embed@1 message `context` (guest → host right-click; `rt.forwardContext`, ctx picks run with the payload; `ContextMenuHost` hands a taken menu to the host); Molly `src/molly/host.ts` hooks + `FrameDeck` several frames over pane slots; `plugin-lifecycle.mjs` `AXF_PLUGINS_DIR`; `check-controls` accepts `fx-toolbtn`. Re-baked molly, amberx-droid, axhub-web, console-web. The live guests merge once redeployed with this runtime (older builds keep drawing their own chrome). Known gaps: guest banner widgets aren't drawn by Molly yet; the Android twin of `context` is deferred (PORTING).
