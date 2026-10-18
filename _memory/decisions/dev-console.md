# Dev Console decisions

- Oct 16 2026: the first app is the AXF Dev Console. It tracks what's built, picks libraries to build by generating demo apps, has a feature list with suggestion dialogs, and a modules & packages tab. The first build includes only what full future scalability needs.
- Oct 16 2026: the Dev Console is a **React/TypeScript (Vite) web app with a Python (FastAPI) API**, live at console.amberxai.com. The Android console stays as the framework's Android showcase. A separate `next-ts` template exists for Next.js apps.
- Features he asked for: build tracker, feature catalog with suggestion dialogs, library picker → demo apps, modules & packages, boilerplate manager (categorized, live preview, third-party import), server control panel, build queue, pending builds, plugins, MCP client.
- Showcase features (10 layouts, 10 light/dark theme pairs, 10 style packs, the six libraries' full UIs, editor, GPS, video, VPS streaming…) come later as demo apps, one library at a time.
- Wants the console in its own private repo eventually, not yet.
