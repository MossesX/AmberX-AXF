# Molly plugin dedupe (embed@1 `host-plugins`)

Brett, Nov 10 2026: "When things are opened in Molly, none of the plugins need to render twice. Molly is only to render
the console's plugin if Molly doesn't have it already."

A plugin that ships in more than one app (inline edit in the console, Molly and AmberX web) must be on screen once when
one of those apps runs inside another. The host's copy is the one the person is already looking at, so the guest skips
its own. This contract is the handshake that tells the guest what the host has. It applies to every plugin, not one.

Reference engine: `framework/core/engines/embed.ts` (messages, `hostPluginSkips`); runtime side `AxfRuntime.hostOwnPlugins`
/ `onHostOwnPlugins` / `askHostOwnPlugins`; console host side `apps/console-web/src/plugins.ts` `dedupeAgainstHost` and
`usePlugins` in `apps/console-web/src/App.tsx`. Fixture keys `hostPluginMessages` and `hostPluginSkips` in
`framework/spec/fixtures/embed-takes.json`, replayed by `framework/spec/check-embed.mts`.

## Parties

- **Guest**: an AXF app running inside another app's frame with the embed@1 marker (`?axf-embed=<host>` or the
  `AXF-Embed/<host>` user agent). Today the Dev Console inside Molly.
- **Host**: the app that frames it. Today Molly (its xLayout plugin's chrome host owns the frames and the messages).

The handshake is not tied to Molly's id or to any embed@1 `take`: any host may answer, and a host that does not answer
changes nothing (see the default below). Standalone (no marker) the guest never asks and never waits.

## Messages

Both ride on embed@1 (`$axf: "embed@1"`), plain JSON, checked on arrival by `parseEmbedMessage`, never trusted for more
than their content. Web: `window.postMessage`; the guest accepts messages from its parent frame only (the runtime's
`listenToHost`), the host posts to the frame's own origin only (never `*`). Android: the same JSON through
`AxfEmbedHost.post` / `AxfEmbedGuest.receive` (deferred, see PORTING.md).

| direction | message | body |
|---|---|---|
| guest → host | `host-plugins-request` | none. "Which plugins do you already have?" Sent once when the guest's runtime starts embedded (not in page mode). A host may also push its answer without being asked. |
| host → guest | `host-plugins` | `plugins: [{ id, version? }]`. The plugins the host has installed **and running now**. An empty list is a valid answer: "I have none". |

Limits (`EMBED_MESSAGE_LIMITS`): at most 200 entries, `id` matching `EMBED_PLUGIN_ID` (`[A-Za-z0-9][A-Za-z0-9._-]{0,119}`),
`version` cut to 40 characters, repeats and bad entries dropped (never the whole message). `host-plugins` may be longer
than the 4000-character small-message cap, like `plugins` and `plugins-enabled`.

### When the host sends `host-plugins`

1. On every `host-plugins-request` from a frame it owns.
2. When one of its frames finishes loading (the `load` event), without waiting to be asked: the guest's request may have
   gone out before the host's listener was attached, and a reload must get the answer again.
3. Whenever its own set of running plugins changes (one switched on or off, installed or removed): the same message
   again to every frame. The guest applies the new list at once, mounting or unmounting as needed.

### What the host lists

Only **plugins** (plugin@1 manifests, `plugins/<folder>/plugin.json`) that are installed and running in the host right
now. Never its framework libraries (settings, toolbars, alerts and the like): those have ids of their own in every app
and are not a plugin's rendering. A plugin the host has on disk but switched off is **not** listed: the guest's copy is
the one that renders then.

## Identity: the plugin id

Two copies are "the same plugin" when their plugin@1 `id` is the same string. Nothing else is compared: not the folder
name, not `provides`, not the name. A plugin that ships in several apps keeps one id in every copy (the same
`plugin.json`); a copy given an app-specific id (`…molly.inline-edit` beside `…console.inline-edit`) is two plugins to
this contract and renders twice. The install steps for a shared plugin must keep the id identical.

## What the guest skips

For every plugin the guest would install whose id is in the host's list, the guest does not install it on this page:
no views, dialogs, nav or menu entries, banners, slots, settings tabs or actions, and its chunk is not fetched. The
decision is `hostPluginSkips(embed, hostList, mine)` in the embed engine (pure; replayed from the fixture):

- not embedded, or no answer yet (`hostList` null): skip nothing;
- **page mode** (`embed.page` set, e.g. a tabable plugin's page shown as a Molly tab): skip nothing, the host asked for
  that exact page and must get all of it (same rule as `skipWhen`);
- otherwise skip every entry of `mine` whose id the host lists, with a reason naming the host and the versions.

The guest only dedupes its **plugins**: its own framework libraries are never matched against the host's list, even if
a host misbehaves and lists them.

Skipped plugins are recorded like `skipWhen` skips: `rt.skippedLibraries` (reason starts with the host's label:
"Molly already has ai.amberx.axf.inline-edit 0.1.0"), one terminal line each and a summary line, and the list in
Settings → Plugins → Libraries ("Not loaded inside molly"). When a later answer no longer lists a plugin, it leaves
`skippedLibraries` and installs.

## Default when the host doesn't answer

The guest waits **`HOST_PLUGINS_WAIT_MS` = 1500 ms** from its request for a `host-plugins` answer before installing
plugins. That wait overlaps the guest's own plugin status fetch, so in practice it costs nothing when the host answers
(a parent window answers within a few milliseconds) and at most 1.5 s inside a host that never will.

- **Answer in time**: install everything except what the host lists.
- **No answer by the deadline**: install everything, exactly as the guest does today (fail open). An old host that does
  not speak this contract, or a host that is not Molly, keeps a complete console. The state reads `timeout`.
- **Late answer** (after the deadline, or a changed list later): applied as soon as it arrives. Plugins the host lists
  are unmounted; ones it dropped are mounted. The lazy loader handles both as it does any enable/disable.

Rendering twice for up to 1.5 s is not possible: nothing is mounted before the answer or the deadline. Rendering twice
after a timeout is the accepted cost of an old or foreign host, and the terminal says so
(`inside <host>: no host-plugins answer, running every plugin`).

State the guest exposes (readable by anything with the runtime, the console's REST/MCP/CLI layer reads the same):

| field | values |
|---|---|
| `rt.hostOwnPluginsState` | `none` (standalone or page mode: never asked) · `waiting` · `answered` · `timeout` |
| `rt.hostOwnPlugins` | the host's last list (`{ id, version? }[]`), or null until it answers |
| `rt.skippedLibraries` | every skipped plugin with its reason (host-dedupe entries beside `skipWhen` ones) |

## Version mismatch rule

**The host's copy wins, whatever the versions.** Brett's rule has no version clause: if Molly has the plugin, Molly
renders it. Comparing versions and picking the newer one would put the newer copy inside the frame while the host's
chrome (menus, toolbars, nav) still points at its own, older one, which is the double rendering this contract exists to
stop.

When the versions differ (plain string inequality; `version` absent on either side counts as unknown, not as a
mismatch):

- the guest still skips its copy;
- the skip reason names both: "Molly already has ai.amberx.axf.inline-edit 0.1.0 (this app has 0.2.0)";
- the guest writes one terminal **warning** per mismatched plugin (`libraries` channel), so the gap shows up in the
  console's terminal and the lazy-loader report;
- `hostPluginSkips` marks the entry `mismatch: true`, so an API or a Plugin Manager row can show "Molly's copy is
  older/newer" without re-deriving it.

A host that wants the guest's copy to render instead (its own is broken, or older and it knows it) leaves that plugin
out of its `host-plugins` list, which is the same as switching its copy off. There is no message for "use yours".

## What this does not do

- It does not switch plugins off in the host. Molly's copy always renders in Molly.
- It does not replace embed@1 `plugins` / `plugins-enabled` (a host that *manages* the guest's plugins with take
  `plugins`). Both can hold at once: the managed list says what the guest may run, the dedupe then removes what the host
  itself already renders.
- It does not dedupe framework libraries or chrome: that is `skipWhen` (`embedded`, `take:<fn>`, `hidden:<type>`).
- It carries no actions, no code, no settings: ids and version strings only.

## Android

The Kotlin twin (`EmbedTakes.parseMessage` reading `host-plugins` / `host-plugins-request`, a native guest asking and
skipping, a native Molly shell answering) is deferred with the Android port (PORTING.md). The fixture keys are marked web
only until then.
