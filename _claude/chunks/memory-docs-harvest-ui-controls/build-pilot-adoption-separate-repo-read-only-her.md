<!-- memory-chunk@1 source=_claude/memory/docs/harvest/ui-controls.md lines=152-182 tokens=679 -->
## Build Pilot adoption (separate repo, read-only here)

Build Pilot is the source these came from, so the swap is mechanical. Its `@axf/react` alias points at its baked
framework copy, which must be re-baked from this branch first.

1. Re-bake the framework (`core/`, `react/`, `ui/`, `libs/`) from AmberX-AXF after this branch merges.
2. In `src/pilot/ui.tsx` delete `Field`, `TextField`, `SelectField`, `Switch`, `Choice`, `ChoiceGrid`, `Note`, `Section`
   and re-export them from the framework so every plugin's `@pilot/ui` import keeps working:
   `export { Field, TextField, SelectField, Switch, ChoiceGrid, Note, Section, type Choice } from '@axf/react';`
   Differences to mind: `Field`'s render-prop is now `(id, describedBy) => …` (the old one was `(id) => …`, still
   compatible); `Note` adds `role="alert"` for warning/danger; `Switch` adds `hideLabel`/`text`; `TextField` gained
   `rows`, `required`, `disabled`, `type`.
3. Delete the `bp-field*`, `bp-input`, `bp-switch*`, `bp-switchrow*`, `bp-choices`/`bp-choice*`, `bp-note*`,
   `bp-section*` rules from `src/pilot/pilot.css` (lines 7–50); keep `bp-form`, `bp-list`, `bp-feature*`, `bp-sheet*`.
   `bp-choice__tag` is reused by `FeatureList` tags — rename that use to `fx-choice__tag`.
4. `src/views/Plugins.tsx:53` hand-rolls a `role="switch"` with `bp-switch` classes: replace with
   `<Switch hideLabel label={`${p.manifest.name} ${on ? 'on' : 'off'}`} checked={on && !p.problem} … />`.
   `FeatureList`'s per-row toggle in `ui.tsx` uses the same classes: replace with `Switch hideLabel` (it is a
   checkbox/radio by role today; keep the `multiple` semantics through `aria-label`).
5. `plugins/android-features/web/index.tsx`: delete its `ParamField` and `Param`; `import { LibraryParamField } from
   '@axf/react'` and `paramToJson`/`paramDefaults` from `@axf/core`. Its values are typed (`Record<string, unknown>`)
   while `LibraryParamField` takes text: keep text answers in step state (`paramDefaults(l.params)`) and convert
   with `paramToJson` when writing `libraries[l.id]`, or wrap: `value={paramText(libs[l.id]?.[p.key] ?? p.default)}`
   and `onChange={(t) => set(... [p.key]: paramToJson(p, t))}`. Catalog params from the console API are already
   library@1 shaped (`key,label,type,default,required,help,choices,min,max`); the `description` field BP read is
   `help` in library@1 — map it if the BP server renames it.
6. Markdown anywhere in Build Pilot (assistant port, `build-pilot-agents`): use `Markdown` from `@axf/react`
   rather than copying the console's renderer again.
7. Run Build Pilot's own checks (`tsc`, its theme check if it has one) and take before/after shots of the Features
   step and the Plugins view.
