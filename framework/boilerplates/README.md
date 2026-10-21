# Boilerplates

Categorized starting points for apps built on AmberX AXF. Each folder holds a `boilerplate.json`:

```json
{ "$axf": "boilerplate@1", "id": "notes", "name": "Notes & Todo", "category": "productivity",
  "features": ["c.notes", "c.texteditor"],          // catalog feature ids the app needs (drives which libraries get added)
  "screens": [{ "id": "home", "label": "Notes", "kind": "list-detail" }],   // screen-template kinds → placeholder views + nav
  "modules": ["ai.amberx.axf.data"],                 // framework modules to depend on
  "libraries": [{ "library": "browser", "params": { "tabGroups": ["library-browser"] } }],  // installable libraries + their wizard answers
  "defaults": { "layout": "focus-top" },             // asset defaults overriding framework/defaults.json
  "screenshots": [{ "screen": "home", "file": "home.png", "caption": "Notes list" }],  // optional, see below
  "status": "planned", "source": "amberx" }
```

**Screenshots (optional, Oct 20 2026):** real captures of an app built from the boilerplate go in
`<id>/screenshots/` (PNG, JPEG or WebP, plain file names, up to 5 MB each; no SVG) and are listed in
`screenshots` (`screen` = a screen id, optional; `caption` optional). The Dev Console serves them at
`GET /api/boilerplates/<id>/screenshots/<file>` (admins / console token). Build Pilot shows them in each
boilerplate's expanded row; a boilerplate without screenshots shows previews rendered from its screen kinds.

`axf init my-app --template android-compose --boilerplate notes` applies one: merges `defaults` into the
manifest, adds `modules`, installs each of `libraries` with the given parameters (missing ones take the
library's defaults — see `axf libraries`), generates a nav-menu asset and one placeholder view per screen, and records the
boilerplate in the manifest. The Dev Console's Boilerplate Manager browses `index.json`, assembles new
boilerplates from the feature catalog, previews screens live on the device, and stages third-party
boilerplates (`source: "import"`) for porting. Regenerate `index.json` with `node framework/cli/boilerplates.mjs`.
