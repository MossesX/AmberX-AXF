# {{APP_NAME}}

Initialized by the **AmberX AXF {{FRAMEWORK_VERSION}}** build engine (`next-ts` template): Next.js 15 (App Router) with the framework baked into `src/axf` and every visual as a hot-swappable asset in `src/assets`.

```bash
npm install && npm run dev     # http://localhost:3000
npm run build                  # static export → out/ (next.config.mjs: output 'export'); drop it for SSR / route handlers
```

- `app/page.tsx` loads the manifest + assets on the server and hands them to `app/AxfApp.tsx`, a client component that creates the runtime once and mounts the shell — the shell routes its own views, so one page is the whole app.
- Add a view in `src/App.tsx`; nav-menu assets pick it up by id. Add pages next to `app/page.tsx` for SEO content outside the shell.
- Every app ships the settings interface (`src/axf/libs/settings`, installed in `src/App.tsx`; `app.settings`, nav item **Settings**): Appearance, Account & security, Connections, **Plugins** (every installed library with its health), About. Plugins add groups or sub-tabs under Settings → Plugins, never a settings screen of their own.
- Everything else (actions, dialogs, assets, `axf validate`) works exactly as in the Vite template.
