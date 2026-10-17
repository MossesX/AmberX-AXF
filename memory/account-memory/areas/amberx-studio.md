---
name: amberx-studio
description: AmberX Studio — the project-management / app-building suite Brett is planning on top of his AmberX Android framework (absorbs his Feature Planner and Dev Console artifacts); stated requirements and stack
sources: [cowork]
aliases: [AmberX Studio, AmberX framework, VX Pad, feature planner, dev console, project management suite]
---
- [stated] Planning (Oct 2026) a full project-management suite to plan, customize and build the AmberX framework and the apps built on it; it must absorb the existing Feature Planner and Dev Console (same features, appearance/layout may change)
- [stated] Stack: Next.js / React / TypeScript frontend, Python backend (same stack he chose to port the planner to)
- [stated] Must support many projects/app builds open at once, each open project with its own independent AI assistant; new apps inherit the suite's AI settings by default
- [stated] AI assistant chat must be dockable/undockable, draggable, resizable; settings must support OpenAI, Claude, Gemini, Groq etc., default = his Claude subscription
- [stated] Wants a no-code interface with integrated AI agents, a browser for libraries/modules/packages to add to an app's plan, and placeholders so the framework can be extended/scaled without breaking builds
- [stated] Process he wants: planning first, interactive UI demos/previews of every screen, he approves or declines each and edits through the agent before anything is built
- VX Pad = first app on the framework (package ai.amberx.vxpad); framework repo lives at C:\Home\AmberX
- [stated] Navigation rule for the suite: the top tabs are the open projects and are the only thing that selects a project; the left rail never changes the tab, every rail item shows that view (planner, screens, theme, templates, libraries, build, Claude Code, settings…) for the selected project
- [stated] Every app on the framework includes a landing/loading screen and a settings interface by default; the app builder must list every interface page of the app and route hooks between screens; wants a Claude Code page in the suite (subscription default, API switch in settings) with a new-app wizard, many predefined templates with thumbnails, and theme/style packages that each have light and dark
- [stated] Oct 2026: interactive Studio prototype published as a claude.ai artifact (https://claude.ai/artifact/9xRKtpraX55Wv7CxHwR2es); sources + FastAPI backend + Next.js scaffold handed off as a zip to continue in a new session
