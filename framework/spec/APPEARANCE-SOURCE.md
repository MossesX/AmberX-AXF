# Appearance source: a developer app's look and settings live on axHub

Brett's decision (Oct 20 2026, refined the same night): **all settings and shared data of his developer apps come
from the axHub data server.** The theme is *data*: the selection (asset id per appearance slot, spacing, hidden chrome)
is a settings document on the hub, never fetched from the hub's web app. A change in any developer app is written
there and every other one follows live. **When axHub is down, a developer app doesn't run**: it shows a
"Waiting for axHub" screen until the hub is back. No local fallback, no default-theme operation, no cached copy.

Developer apps: the AXF Dev Console (web and Android), Build Pilot (web now, Android when it exists), axHub's own
pages, the AXHub phone app, and any future app that opts in. **Not** every app built on AXF: an ordinary app keeps its
own local settings. Voice Vault is deliberately out (offline password vault).

## The document: `appearance@1`

Project `shared`, path `settings/appearance.json` on the hub's data server (`/projects/_shared/_data/settings/appearance.json`,
axhub-projects@1). Ids and small values only, never asset bodies or code:

```json
{
  "$axf": "appearance@1",
  "slots":   { "color-theme": "arctic-daylight", "style-theme": "glass-orbit", "layout": "focus-top" },
  "spacing": "tight",
  "hidden":  { "toolbar": true },
  "palette": { "scheme": "light", "bg": "#f2f5f8", "fg": "#14202b", "muted": "#5d6d7c", "card": "#ffffff", "line": "#d6dfe7", "accent": "#1f6feb", "danger": "#d1373f", "ok": "#1a8f5a" },
  "updatedBy": "axf-console", "updatedAt": "2026-10-21T00:00:00Z"
}
```

- `slots`: appearance slot → asset id. `uac-policy` is never in it (access comes from the account / the app).
- `spacing`: `tight | compact | regular`. `hidden`: hideable (chrome) type → hidden; absent = the app's default.
- `palette`: a few colour literals derived from the active colour theme, for apps that don't run the theme engine
  (axHub's own pages). Written by whichever AXF app changes the colour theme.
- Unknown fields are dropped on read and never written back. Over 16 KB → not a document.

Engine: `framework/core/engines/appearance.ts` = Kotlin `ai.amberx.axf.kernel.engine.AppearanceEngine`, both pinned by
`spec/fixtures/appearance.json` (`check-appearance.mts`, `AppearanceConformanceTest`):

| | |
|---|---|
| `parseAppearance(text)` | text → document or null (bad JSON, wrong frame, too big); shape-checks every value |
| `resolveAppearance(doc, has)` | against the app's registry: an id the app doesn't ship is **skipped** (that slot keeps the app's default: a missing asset, not a fallback); a hidden flag on a non-hideable type is skipped; never throws |
| `mergeAppearance(base, change, by, now)` | one app's change over the latest document, **per key, last write wins** (the framework's UI-editor rule); keys the change doesn't name are kept, including slots of types this app doesn't have |
| `paletteFromColorTheme(data)` | the `palette` block from a colour theme's tokens |
| `appearanceRetryMs(attempt)` | reconnect backoff 1 s → 30 s |

## The hub side (axHub decision #88)

`GET/PUT <hub>/data/<project>/<path>` (ETag = version, `If-None-Match` → 304, `If-Match` → 409 with the current
version, JSON checked, 64 KB cap), `GET /data/<project>` (list), `GET /data-events?watch=shared/settings/appearance.json`
(server-sent events: `change` on every write through any path, the MCP tools and claude-sync included; a plain
streamed GET, so it passes Traefik). Auth: a signed-in hub **admin** reads and writes; a **user** reads and writes only
with the hub permission `data.write`; the MCP bearer token reads and writes (machines). Browser writes must come from
the hub's own Origin or one in `AXHUB_DATA_ORIGINS` (CORS with credentials; https origins under the cookie domain pass).
The hub never interprets a document. Any other settings document of a developer app goes through the same mechanism:
`<project>/settings/<name>.json`.

## The runtime: `AppearanceSource` (off by default)

```ts
interface AppearanceSource {
  state(): AppearanceSourceState;                       // connecting | ready {version} | unauthorized {reason} | unreachable {reason, retryInMs, attempt}
  subscribe(l: (ev: {doc, version} | {state}) => void): () => void;
  start(); stop(); refresh();                            // refresh = re-read now (UI-editor rule: fresh on focus / resume)
  save(change: { slots?, spacing?, hidden?: {type: bool|null}, palette? });   // this app's keys only
}
rt.attachAppearanceSource(src)   // makes the app a developer app; rt.detachAppearanceSource()
rt.appearanceReady()             // true without a source, or when the source is ready
rt.appearanceSkipped()           // ids the last document named that this app doesn't have
```

Same contract in Kotlin (`AxfRuntime.attachAppearanceSource`, `appearance: StateFlow<AppearanceSourceState?>`).

What the runtime does with it:

- **Apply** (a document arrives): every appearance slot starts from the app's manifest default, then takes the
  document's id when the app has that asset; spacing and hidden go through the same settings keys the UI uses
  (`axf.appearance.spacing`, `axf.hide.<type>`); a key missing from the document = the app's default. No permission
  check: the document *is* the saved setting.
- **Push** (a local change): `swap`, `swapAll`, `setSpacing`, `setSlotHidden`, `randomize`, `reset` push only the keys they
  touched (plus `palette` when the colour theme changed) — **after** the UAC gate, so a role without `assets.swap`
  changes nothing and pushes nothing (`bindPrincipal` + the console's `console.themes` grant still decide). A pushed
  document is never echoed back. `uac-policy` is never pushed.
- **Waiting**: `AppShell` (web) / `AxfRoot` (Android) render only the waiting screen while the source isn't `ready`:
  what's unreachable and why, the next try, Retry, and (Android, when the app provides it) the hub's sign-in page.
  Themed by the app's default assets. No "run anyway".
- `refreshFromSaved()` (UI-editor rule) also asks the source to re-read.

## Implementations

- **Web** `framework/react/hubAppearance.ts` → `HubAppearanceSource({ hub, appId })`: fetch with `credentials: 'include'`
  (the browser's hub session cookie; the console, Build Pilot and the hub are same-site under `.amberxai.com`),
  `If-Match` on every save, 409 → re-read + re-merge our keys + one retry, SSE live updates (polling when `live: false`),
  backoff, re-read on `focus` / `online`. https only (http for localhost). Attached by `src/main.tsx` when the manifest has
  `developer.hub` (`axf init --developer [hub]`); the console attaches it from `/api/me` → `appearanceHub`
  (`AXF_APPEARANCE_HUB` on the server; `off` = no source, local development only).
- **Android** `framework/android/lib-hub`: `HubAppearanceSource(hub, appId, credentials)` on OkHttp (no redirects, SSE
  stream + re-read on resume), `HubModule` attaches it at start, `HubSignInView` (the hub's sign-in page in a locked
  WebView) + `cookieCredentials` (the session cookie from the WebView store). Credentials are the app's: the library
  stores nothing. `AxfActivity.onResume` re-reads; `hubSignIn` gives the waiting screen a sign-in. The android-compose
  template adds `HubModule` when the manifest has `developer`.
- **axHub's pages**: read `palette` from the same document (no AXF dependency).

## Who may read / write (decided, say if you disagree)

- Read: any signed-in hub account (users too), because every developer app must be able to *follow* the look, and a
  console user with `console.themes` must see the current document to change it. The document holds ids only.
- Write: hub admins, and users granted `data.write` on the hub. In the console the UAC gate (`assets.swap` via
  `console.themes`) applies first, so a plain user can't change the look even if the hub would accept the write.

## When axHub is down

The developer app shows the waiting screen and retries (1 s → 30 s). The console is behind the hub's wall anyway, so
a hub outage already blocks it at the proxy. **Emergency paths (unchanged, documented):**

1. VPS shell (Moshi / SSH as root): fix or restart the hub (`docker ps`, Coolify).
2. `AXF_WALL=off bash deploy/install-console.sh` reopens the console without the wall **and** turns the hub source
   off (decision Oct 21 2026: a saved `.axf-console/wall` = `off` makes `/api/me` report `appearanceHub: "off"`), so
   the console runs on its own local settings while the hub is repaired. `AXF_WALL=on` brings both back. An explicit
   `AXF_APPEARANCE_HUB` always wins (`off`, or another hub).
3. Build Pilot: `VITE_AXF_HUB` at build time; its server has no hub dependency.

Security: the document is not an injection path (ids validated against the app's registry, values shape-checked,
unknown fields dropped, size-capped, `uac-policy` excluded, the hub refuses non-JSON and oversized bodies); hub down
opens nothing (the app shows a card and nothing else); no secrets anywhere (credentials are the browser's cookie or
the app's own store).
