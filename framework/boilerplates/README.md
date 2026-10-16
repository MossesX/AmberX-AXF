# Boilerplates

Categorized starting points for apps built on AmberX AXF. Each folder holds a `boilerplate.json`:

```json
{ "$axf": "boilerplate@1", "id": "notes", "name": "Notes & Todo", "category": "productivity",
  "features": ["c.notes", "c.texteditor"],          // catalog feature ids the app needs (drives which libraries get added)
  "screens": [{ "id": "home", "label": "Notes", "kind": "list-detail" }],   // screen-template kinds → placeholder views + nav
  "modules": ["ai.amberx.axf.data"],                 // framework modules to depend on
  "defaults": { "layout": "focus-top" },             // asset defaults overriding framework/defaults.json
  "status": "planned", "source": "amberx" }
```

`axf init my-app --template android-compose --boilerplate notes` applies one: merges `defaults` into the
manifest, adds `modules`, generates a nav-menu asset and one placeholder view per screen, and records the
boilerplate in the manifest. The Dev Console's Boilerplate Manager browses `index.json`, assembles new
boilerplates from the feature catalog, previews screens live on the device, and stages third-party
boilerplates (`source: "import"`) for porting. Regenerate `index.json` with `node framework/cli/boilerplates.mjs`.
