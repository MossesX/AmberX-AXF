# Appearance source: a developer app's look and settings live on axHub

> **The rule (Brett, Nov 1 2026, changed by build `skins`, Nov 4 2026): the apps get their appearance from axHub only,
> with no local look tabs and no local fallback, and each app has its own look document there.** "By default they're
> all their own": slots, spacing and hidden chrome come from the app's `shared/settings/looks/<app>.json` (app-look@1,
> below), so a pick in one app stays in that app. Control@1 token overrides (`axf.tokens.*`) in `appearance.json` still
> reach every app. **Every app ships every shareable asset** (`framework/cli/shared-assets.mjs`: baked at `src/axf/assets`,
> CI-checked), so a pick made anywhere resolves everywhere.

## Each app's own look: `app-look@1`

Project `shared`, path `settings/looks/<app>.json`. Written only by that app, or by `framework/cli/skins.mjs` for voice,
MCP and REST. The format is in one module, `framework/core/engines/skin.ts` + `skin-rules.mjs`.

- `default`: the snapshot of the look the app had when skins landed (`skins.mjs snapshot --all`), so nothing changed.
- `own`: picks made with no skin on. `skin`: `{ use, id, overrides }`, the Use skin switch, the skin and the picks that
  beat it. `undo`: the one step Restore to default can take back.
- Effective look = default + own picks; with Use skin on, that + the skin + its overrides.

An app without a hub source keeps the same document in a setting (`axf.skin.look`), so a new app from a template gets the
same Settings → Appearance. The sections below describe the shared document, which stays the transport and the source
of the shared token overrides.

Brett's decision (Oct 20 2026, refined the same night): **all settings and shared data of his developer apps come
from the axHub data server.** The theme is *data*: the selection (asset id per appearance slot, spacing, hidden chrome)
is a settings document on the hub, never fetched from the hub's web app. A change in any developer app is written
there and every other one follows live. **When axHub is down, a developer app doesn't run**: it shows a
"Waiting for axHub" screen until the hub is back. No local fallback, no default-theme operation, no cached copy.

Developer apps: the AXF Dev Console (web and Android), axHub's own
pages, the AXHub phone app, and any future app that opts in. **Not** every app built on AXF: an ordinary app keeps its
own local settings. Voice Vault is deliberately out (offline password vault).

## Every asset type, at any scope: skin-coverage@1 (build skins-asset-types, Nov 7 2026)

How a skin reaches each registered asset type is derived from the registry (`framework/schemas/asset-types.json`) and
the style targets (`framework/schemas/customize.json`) by `framework/core/engines/skin-coverage.mjs`; nothing names a
type by hand, so a new type is covered (or fails CI) the moment it is registered:

| by | how the skin reaches it | which types |
| --- | --- | --- |
| `slot` | the skin picks the active asset (`assets[type]`, the three themes) | every type not excluded from appearance slots |
| `parts` | the skin styles the type's drawn elements (`parts[type]`: customize tokens under the type's style target; composite: box / text / icon / items) | widgets and attachables (label, badge, clock, counter …); slot types with a target take parts too |
| `reference` | the skin names it through a field (`iconPack`) or an asset it picks (`via: branding` for logo marks) | declared on the registry entry |
| `bundle` | a whole look the skin stands in for | design package, style package, interface, skin (declared) |
| `none` | no look (declared with a `why`) | access policy, help, job type, card |

`node framework/spec/check-skin-coverage.mjs` fails on any type with none of these (a widget without a style target, an
excluded type with no declaration, a bad declaration). `node framework/cli/skins.mjs coverage` and `covers <skin>`
print the table; Settings → Appearance → *What a skin covers* shows it.

**Scopes** (the icon-map model): the chain for a place is `plugin:<id>` → `ui:<view>` → `app` → `global`, and the first
level that is not *inherit* decides; its overrides and those of every level nearer the leaf apply (child over parent).
`global` is the `skin` field of the shared appearance@1 document (`skins.mjs global <skin>`); an app takes it only while
`skin.inherit` is on (Follow the hub-wide skin; off by default: "by default they're all their own"). `ui:` and `plugin:`
states live in the app's look document under `scopes` (`{ use: on | off | inherit, id, overrides }`). The runtime draws
a sub level that resolves differently from the app as a scoped view (`rt.skinScoped(key)`, like an interface scope)
under `<SkinScope>` on every view root and every plugin root; a skin's `iconPack` lands in `axf.icons.pack.<scopeKey>`
and its `parts` in the customize sheet. Pure functions: `resolveSkinChain`, `resolveLookSkin`, `composeLookAt`,
`setScopeSkin`, `setInheritSkin`; fixture `spec/fixtures/skin.json` (`coverage`, `scopes`), `spec/check-skin.mts`.

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
  (the browser's hub session cookie; the console and the hub are same-site under `.amberxai.com`),
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

## Design theme precedence (Nov 1 2026)

Brett: "When a design theme is loaded the individual style and color themes are not applied. Only when something
changes is the design pack overridden with the individual packs." Engine: `core/engines/designpackage.ts`
(`designLookSlots`, `overrideAfterPick`, `normalizeDesignOverrides`, `designLookLabel`); runtime: `applyAppearance`,
`swap`, `applyDesignPackage`, `designOverrides()`.

1. While a design package is loaded (slot `design-package`), its `style-theme` and `color-theme` are in force. A style
   or colour slot the document still carries is ignored. **The app's default package counts as loaded:** a document
   without a `design-package` slot (or naming one this app doesn't ship) leaves the app on its manifest default,
   `hub-default`, and that package's themes win over the document's style and colour slots the same way.
2. Picking a style or colour theme afterwards records an override for that part only, in the look setting
   `axf.appearance.overrides` (`{ "style-theme"?: id, "color-theme"?: id }`), which rides `settings` like every other
   look setting, so every app agrees. Picking the package's own theme drops that override. The slot itself is pushed
   too (`slots.style-theme`), so an app without the package (or an older build) still sees the pick.
3. Loading a design package (again) clears every override. **A design package is never just a slot** (Nov 3 2026):
   `swap('design-package', id)`, the generic `swap:design-package:<id|next|prev>` action and `design.package:<…>` all
   load the package (`applyDesignPackage`: its four themes, its extras, overrides cleared), so no app can carry the
   package slot with another package's themes. Loading the package already loaded is a reload (overrides cleared).
4. **Restore default = the default design theme loaded in full** (Nov 3 2026): every look setting and override cleared,
   the manifest defaults restored, then the manifest's default package applied with its extras (spacing, chrome), so
   "Restore" in any app puts every app on exactly Hub Default. `appliedDesignPackage()` is the loaded package = the
   `design-package` slot (shared), never a local note, so every app names the same one.
5. An override or package theme the app doesn't ship falls back (override → package → the pick), never a broken look.
   A package the app doesn't ship is skipped like any slot id (the app stays on its default package, warned in the
   terminal); since every listed app ships every shared asset this only happens for an app-own package.

Why the overrides ride `settings` and not a first-class document field (Fable review, Nov 3 2026): the document's
contract (`appearance@1`, fixture `appearance.json`, Kotlin `AppearanceEngine`) stays unchanged on both ports; the key
is a look setting by the same rule as every plugin look setting (per key, last write wins, cleared when the document
doesn't list it), and `resolveAppearance` never has to know about packages. The cost is that two keys describe one
pick (`slots.style-theme` and the override), which `designLookSlots` reconciles; the fixture-pinned engine stays pure.

Settings → Appearance in every app is selection only: Design theme, Style theme, Colour theme, Restore. The status
line reads "Hub Default (style changed)". Plugin settings (Banner settings and its Apply to all) still edit their own
look, shared through the same document.

**Retired look settings:** `axf.look` (Sliders), `axf.custom.*` (per-asset tokens) and `axf.roll.*` (rolls) are never
applied or sent; a document that still carries them is cleaned once by the first app that reads it
(`RETIRED_LOOK_SETTINGS`, `isRetiredLookSetting`). **Retired slot:** `appearance-package` (the type the design package
replaced) is in `APPEARANCE_NEVER`: dropped on read like `uac-policy`, never "skipped", and gone from the hub with the
next write by any app (`mergeAppearance` normalizes). Fixture row `retired-slot`.

**Default look:** design package `hub-default` (style theme `hub`, colour theme `hub-night`) is the default of the Dev
Console (GizmoX AI Studio), axHub web and AmberX.

## When axHub is down

The developer app shows the waiting screen and retries (1 s → 30 s). The console is behind the hub's wall anyway, so
a hub outage already blocks it at the proxy. **Emergency paths (unchanged, documented):**

1. VPS shell (Moshi / SSH as root): fix or restart the hub (`docker ps`, Coolify).
2. `AXF_WALL=off bash deploy/install-console.sh` reopens the console without the wall **and** turns the hub source
   off (decision Oct 21 2026: a saved `.axf-console/wall` = `off` makes `/api/me` report `appearanceHub: "off"`), so
   the console runs on its own local settings while the hub is repaired. `AXF_WALL=on` brings both back. An explicit
   `AXF_APPEARANCE_HUB` always wins (`off`, or another hub).

Security: the document is not an injection path (ids validated against the app's registry, values shape-checked,
unknown fields dropped, size-capped, `uac-policy` excluded, the hub refuses non-JSON and oversized bodies); hub down
opens nothing (the app shows a card and nothing else); no secrets anywhere (credentials are the browser's cookie or
the app's own store).
