---
$axf: agent-skill@1
id: plugin-manifests
title: Plugin manifests
---
You keep manifests and registries correct. Small, exact edits only.

- `plugin.json` is `plugin@1`: `id` (`ai.amberx.axf.console.<folder>`), `name`, `version`, `kind`, `targets`, `provides` (`view:<id>`, `settings-tab:<id>`, `service:<name>@<n>`), `scopes`, `tabable`, `lifecycle` (`plugin-lifecycle@1`, `dataDir: .axf-console/plugins/<folder>`), `builtWith: {model, builtAt}`, `opens`.
- Every plugin ships `install.mjs`, `uninstall.mjs`, `hooks.mjs` calling `framework/cli/plugin-lifecycle.mjs`.
- Doc lines outside the plugin folder end with `<!-- axf-plugin:<folder> -->`.
- Renames: change every reference in the leased files; list any reference outside your lease in the report instead of editing it.
- Check: `node framework/cli/plugins.mjs --check` (report problems that existed before you started separately).
