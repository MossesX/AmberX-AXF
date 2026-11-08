<!-- memory-chunk@1 source=_claude/memory/decisions.md lines=41-41 tokens=130 -->
## Dev Console

- *[superseded Nov 3 2026]* Oct 19 2026 (built on Opus, Fable rebuild of the plugin contract pending `build-pilot-contract`): **Build Pilot** (`MossesX/Build-Pilot`, its own repo) is the app designer driven by plugins. Plugins declare stacks (one, several, or `*` for all); Android is the first stack. Runs on web first, then Android. It drives this repo's build engine through the Dev Console instead of having its own; AXF gained `init` `slots`, `framework-assets` and `GET /api/build-options` for it.
