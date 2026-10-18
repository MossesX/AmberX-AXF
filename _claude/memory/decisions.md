# Decisions (AmberX AXF)

## Framework

- Named **AmberX AXF** (originally "Frame", from his spec doc `docs/Frame.md`). Cross-platform: Android (Kotlin/Compose), React/Next/TypeScript/Node, Python/PyQt6 later; quick porting between stacks and seamless switching between third-party UI libraries.
- **Everything visible is a hot-swappable asset** (`asset@1`): themes, layouts, menus, toolbars, nav, dialogs, buttons, sliders, containers, UAC policy… All left at defaults, every app looks identical.
- **The framework is built on the fly by the apps that use it**: each app breaks out libraries, modules, packages and assets into the framework. The first app on a port sets conventions but contributes only one template; its hard constraint is engine compatibility for porting.
- Oct 2026: the Android port is built alongside the first Android app, which defines the kernel, engines, templates, assets and placeholders for future ports.
- Oct 18 2026: layout regions have a typed slot contract (`asset-types.json` → `layout.slots`); toolbar, nav-menu and app-menu are styled by the component style engine.
- Oct 18 2026: every UI build (session, terminal, MCP, API) takes `--` switches for options; `--wrap-groups` makes every section/group collapsible with a small top-right icon. Future builds default it off; existing files set on.
- Oct 18 2026: live framework data is read from the server hub (now `/projects/amberx-axf/_data/`, see below).
- Planned next big rule (pending, Fable): **every UI element is a named asset** (element vs parent assets, namespaced ids, instance vs skin, slot rebinding).
- axHub's control interface is a Dev Console **plugin** (not a hardwired tab); approving pending calls needs a PIN only Brett knows.
- Oct 18 2026 (built on Opus): every project built with or for AmberX has a manifest (`project.manifest.json`, project-manifest@1) defining its identity and repo (a repo that doesn't exist yet is still defined, for future naming); its `name` names the project's folder in the hub's `/projects`. Every template ships one, `axf init` fills it in, and the build engine refuses to load or compile a project whose manifest fails validation. The rules live in the Dev Console's new **Standards** section. Each hub project folder has `_data/` (the manifest's `data.shared`, laid out like the project) and `_claude/` (memory, instructions, rules, shared); projects have the same `_claude/`. axHub decisions #70-#76.

## Dev Console

- Oct 16 2026: the first app is the AXF Dev Console. It tracks what's built, picks libraries to build by generating demo apps, has a feature list with suggestion dialogs, and a modules & packages tab. The first build includes only what full future scalability needs.
- Oct 16 2026: the Dev Console is a **React/TypeScript (Vite) web app with a Python (FastAPI) API**, live at console.amberxai.com. The Android console stays as the framework's Android showcase. A separate `next-ts` template exists for Next.js apps.
- Features he asked for: build tracker, feature catalog with suggestion dialogs, library picker → demo apps, modules & packages, boilerplate manager (categorized, live preview, third-party import), server control panel, build queue, pending builds, plugins, MCP client.
- Showcase features (10 layouts, 10 light/dark theme pairs, 10 style packs, the six libraries' full UIs, editor, GPS, video, VPS streaming…) come later as demo apps, one library at a time.
- Wants the console in its own private repo eventually, not yet.
