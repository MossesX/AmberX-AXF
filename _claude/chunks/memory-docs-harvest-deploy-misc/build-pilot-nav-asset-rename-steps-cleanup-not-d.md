<!-- memory-chunk@1 source=_claude/memory/docs/harvest/deploy-misc.md lines=124-142 tokens=375 -->
## Build Pilot: nav asset rename steps (cleanup; not done here)

Build Pilot edited three framework starters in place: `src/assets/nav-menu/{icon-rail,pill-tabs,sidebar-list}.json`
keep the starter ids/names but carry Pilot's items (home, designer, plugins, assistant, agents, assets, account,
settings; sidebar header "Workspace"). A re-bake or `axf` asset sync would overwrite them, and another app picking
`sidebar-list` expects the starter. Steps in the Build Pilot repo:

1. Copy `src/assets/nav-menu/sidebar-list.json` to `src/assets/nav-menu/pilot-nav.json`; set `"id": "pilot-nav"`,
   `"name": "Pilot navigation"`, `"author": "Build Pilot"`, keep `data` as is (style list, header Workspace).
2. If the rail/pill layouts are wanted as choices, do the same for `pilot-nav-rail` (from icon-rail, style rail) and
   `pilot-nav-pills` (from pill-tabs, style pills); otherwise drop them.
3. Restore the three starters byte-for-byte from AmberX-AXF `framework/assets/nav-menu/` (or re-bake assets).
4. `axf.manifest.json` → `defaults["nav-menu"]: "pilot-nav"`.
5. Anything that picks or rolls nav assets by id (none found by grep outside the assets folder) → the new ids.
6. `node ../amberx-axf/framework/cli/axf.mjs validate .`, `npm run typecheck && npm test`, and
   `node ../amberx-axf/framework/cli/check-theme.mjs src plugins`; screenshot before/after (`scripts/rebuild-shots.mjs`).

No other nav renames in this repo for this group (axhub `blank-nav` → `axhub-nav` belongs to another group).
