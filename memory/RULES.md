# Brett's working rules and decisions (active in every session)

**The live copy is on axHub at `memory/amberx-axf/`** (the hub is the source of truth for every Claude session on every device). This `memory/` folder is a read-only mirror: `axhub-memory load` (the SessionStart hook) refreshes it at session start and falls back to it when the hub is down. Loaded here by `CLAUDE.md`.
When something here changes in conversation, save it on the hub (`axhub.memory_write` with repo `amberx-axf`, or `printf '%s' "..." | axhub-memory write <path>`), then commit the refreshed mirror.

## How to work with Brett
- He works mostly from his phone (Samsung Galaxy S26 Ultra), often in Moshi (mosh) on his Hostinger VPS. Lead with the result, short paragraphs, phone-readable.
- **Model choice before every build:** recommend Fable / Opus / Sonnet and why, then ask him to pick and wait. Only the top three models. Fable where the strongest reasoning is needed (kernel internals, cross-port contracts, heavy refactors), Opus for everything else (and anything security-adjacent: servers, shells, auth, deploy), Sonnet only when you're sure Opus isn't needed. You can't switch models yourself: if his pick differs, ask him to run `/model <name>`.
- **Pending builds:** before any build, check the pending list (`node framework/cli/pending.mjs`, MCP `pending_list`, console → Pending builds). Work he says should wait on Fable goes there (and on the claude.ai Pending Builds page, artifact `HTwGSP7HcEt5yBd3MNz2Ye`, db collection `builds`). "Add to the pending build list" means park it, don't build it.
- **Live data is read from the server hub:** pending list, plan, build queue, catalog status, libraries index and tracker live in `/opt/axhub/persist/amberx-axf/` on the VPS (`framework/cli/persist.mjs`). Repo copies are seeds/snapshots; `persist.mjs pull` then commit to snapshot.
- **Shared memory = axHub `memory/<repo>/` + the repo.** Phone, VPS, desktop and claude.ai sessions don't share chat history. Save new rules and decisions to the hub, commit and push code often, keep `CLAUDE.md` Status current.
- **No secrets in the repo** (tokens, passwords, keys, credentialed IPs). Environment variables or GitHub Actions secrets only.
- GitHub account `MossesX`; a new repo must exist on GitHub before a session can push to it. AmberX-AXF is private. Don't create the separate console repo until he says so.
- VPS: Hostinger, runs **Coolify**; its Traefik proxy owns 80/443, so web apps go behind it as Coolify apps (no separate nginx). Domain `amberxai.com`. Claude Code and mosh are installed there.
- axHub (`MossesX/axHub`, axhub.amberxai.com) is his connector hub; use its MCP tools (`list_services`, `describe_service`, `call`) to reach his services instead of asking for credentials.

## Framework decisions (AmberX AXF)
- Named **AmberX AXF** (originally "Frame", from his spec doc `memory/project-docs/Frame.md`). Cross-platform: Android (Kotlin/Compose), React/Next/TypeScript/Node, Python/PyQt6 later; quick porting between stacks and seamless switching between third-party UI libraries.
- **Everything visible is a hot-swappable asset** (`asset@1`): themes, layouts, menus, toolbars, nav, dialogs, buttons, sliders, containers, UAC policy… All left at defaults, every app looks identical.
- **The framework is built on the fly by the apps that use it**: each app breaks out libraries, modules, packages and assets into the framework. The first app on a port sets conventions but contributes only one template; its hard constraint is engine compatibility for porting.
- **Extraordinary care for expansion**: placeholders everywhere, nothing in the initial build may constrain later scaling. Open registries, typed placeholders, new types/extension points/plugins never need kernel changes.
- Engine compatibility across ports is a hard constraint: the Kotlin kernel and TS `framework/core` are the same design; `framework/spec/fixtures` are the contract.
- **Every app gets a landing/loading screen and a settings interface by default.** Every app compiled by the build engine ships the settings interface and lib-settings.
- **Plugins:** each plugin gets a Plugin Manager entry (info, enable/disable, logs, settings). Plugins never ship their own settings screen; they add tabs to the app's settings interface. Plugin UIs use theme tokens only (`framework/spec/THEMING.md`).
- axHub's control interface is a Dev Console **plugin** (not a hardwired tab); approving pending calls needs a PIN only Brett knows.
- Layout regions have a typed slot contract (`asset-types.json` → `layout.slots`); toolbar, nav-menu and app-menu are styled by the component style engine.
- Planned next big rule (pending, Fable): **every UI element is a named asset** (element vs parent assets, namespaced ids, instance vs skin, slot rebinding).

## Dev Console decisions
- The **Dev Console is a React/TypeScript (Vite) web app with a Python (FastAPI) API**, live at console.amberxai.com. The Android console is kept as the framework's Android showcase. A separate `next-ts` template exists for Next.js apps.
- Console features he asked for: build tracker, feature catalog with suggestion dialogs, library picker → demo apps, modules & packages, boilerplate manager (categorized, live preview, third-party import), server control panel, build queue, pending builds, plugins, MCP client.
- Showcase features (10 layouts, 10 light/dark theme pairs, 10 style packs, the six libraries' full UIs, editor, GPS, video, VPS streaming…) come later as demo apps, one library at a time.

## Links he uses
- Kernel checklist: https://claude.ai/artifact/DvUPLjKSM3tEVTsL8pPtE2 (db `checklist/state`)
- Pending Builds: https://claude.ai/artifact/HTwGSP7HcEt5yBd3MNz2Ye (db `builds`)
- Server control panel: https://claude.ai/artifact/JJDQfCHh4jXChe6KPCP6C6
- AmberX Studio prototype (earlier, separate line): https://claude.ai/artifact/9xRKtpraX55Wv7CxHwR2es

## His other projects (context only)
AmberX Studio (`memory/account-memory/areas/amberx-studio.md`), PilotX (`MossesX/pilotX`), ShipX, ActiveX (`MossesX/ActiveX`): details under `memory/account-memory/`.
