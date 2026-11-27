# Skins (console plugin, folder skin-gallery)

Change skins in one place: a gallery of every skin with a live preview (desktop and phone width), one-tap **Use skin**,
**Back to skin**, **Restore to Default** and **Undo**, at any scope: the whole hub, one app, one screen (`ui:<view>`) or
one plugin (`plugin:<id>`). Every action is a skin-switch@1 command (`framework/core/engines/skin-switch.mjs`) over the
documents the framework skins CLI already writes (each app's app-look@1 document, the hub-wide skin on the shared
appearance document): no second store.

| Way in | How |
| --- | --- |
| Screen | Nav → Plugins → Skins; `console_open {kind: screen, target: skin-gallery, focus: …}` with focus `skin/<id>`, `scope/<scope>` or `preview/<id>?view=phone`; hash `#/skin-gallery?skin=<id>&scope=<scope>&view=phone` |
| REST | `GET /api/plugins/skin-gallery/skins` (with coverage), `/scopes`, `/state?scope=`, `/open?skin=&scope=&view=`; `POST /use {skin, scope}`, `/back {scope, slot?}`, `/restore {scope}`, `/undo`, `/scope {scope, follow}` |
| MCP | plugin commands (`plugin-commands@1`): tools `skin-gallery_list / _scopes / _state / _open / _use / _back / _restore / _undo / _scope` |
| CLI | `axf skin-gallery list \| state \| use \| back \| restore \| undo \| scope \| open` (`axf skin-gallery use --skin <id> --scope hub`), or local: `node apps/console-web/plugins/skin-gallery/skin-gallery.mjs use <id> --scope hub` |
| Voice | AmberX runs the same plugin commands ("use skin atelier for the hub", "undo the skin") |

Scopes: `hub` · `app` / `app:<id>` · `ui:<view>` · `plugin:<id>`. The acting app (`--app`, default `axf-console`) keeps
the one undo record in its look document.

Data: none of its own (`.axf-console/plugins/skin-gallery` is created empty); uninstalling leaves the hub's look documents as
they are. Test: `python3 apps/console-web/plugins/skin-gallery/test.py`.
