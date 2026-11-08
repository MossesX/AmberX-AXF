<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/enterprise-branding-3.md lines=23-29 tokens=202 -->
## Tests before → after
- console-web typecheck + build ✓ → ✓; theme-swap ✓ → ✓; menu-reach 228 ✓; interface-scope 7 ✓.
- amberx-droid `test.mjs` 1629/1630 (banner default) → 1863/1863; build ✓.
- check-theme ✓, check-controls ✓, check-plugin-pages (new) ✓ 26 heads in 44 plugins; plugin-lifecycle check clean for every touched plugin.
- check-brand 205, check-design-package 729, check-style-packages 744, check-design-language 427, check-interface 63, check-toolbars 590, check-appearance 100, check-app-menu 123, check-settings-ui 43, check-widgets 241 — all green.
- Plugin self-tests green except three that fail on the base too (profile data): fable-rebuilds, feature-assist, claude-handoff `test.py`. `tracker.mjs --check` fails on the base as well (391 items without status in the Refactor profile).
