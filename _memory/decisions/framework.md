# Framework decisions (AmberX AXF)

- Named **AmberX AXF** (originally "Frame", from his spec doc `docs/Frame.md`). Cross-platform: Android (Kotlin/Compose), React/Next/TypeScript/Node, Python/PyQt6 later; quick porting between stacks and seamless switching between third-party UI libraries.
- **Everything visible is a hot-swappable asset** (`asset@1`): themes, layouts, menus, toolbars, nav, dialogs, buttons, sliders, containers, UAC policy… All left at defaults, every app looks identical.
- **The framework is built on the fly by the apps that use it**: each app breaks out libraries, modules, packages and assets into the framework. The first app on a port sets conventions but contributes only one template; its hard constraint is engine compatibility for porting.
- Oct 2026: the Android port is built alongside the first Android app, which defines the kernel, engines, templates, assets and placeholders for future ports.
- Oct 18 2026: layout regions have a typed slot contract (`asset-types.json` → `layout.slots`); toolbar, nav-menu and app-menu are styled by the component style engine.
- Oct 18 2026: every UI build (session, terminal, MCP, API) takes `--` switches for options; `--wrap-groups` makes every section/group collapsible with a small top-right icon. Future builds default it off; existing files set on.
- Oct 18 2026: live framework data is read from the server hub (now `/Claude/projects/amberx-axf/data/`).
- Planned next big rule (pending, Fable): **every UI element is a named asset** (element vs parent assets, namespaced ids, instance vs skin, slot rebinding).
- axHub's control interface is a Dev Console **plugin** (not a hardwired tab); approving pending calls needs a PIN only Brett knows.
