<!-- memory-chunk@1 source=_claude/memory/docs/harvest/ui-controls.md tokens=592 -->
## What moved (from → to)

| Item | From | To |
| --- | --- | --- |
| `Field`, `TextField`, `SelectField`, `Switch`, `ChoiceGrid`, `Note`, `Section` | Build Pilot `src/pilot/ui.tsx` (+ `pilot.css` `bp-*`) — read-only, left in place | `framework/react/components/Forms.tsx`; CSS `.fx-field`, `.fx-switch`, `.fx-switchrow`, `.fx-choices`/`.fx-choice`, `.fx-note`, `.fx-section` in `framework/ui/axf.css` |
| `role="switch"` toggles | `plugins/plugin-switches/web/index.tsx` (+ its own track/thumb CSS), `plugins/theme-manager/web/ThemeManager.tsx` (native checkbox), `framework/libs/settings/index.tsx` (toggle setting + Assets in rolls, native checkbox), console `Explorer.tsx` FlagRow and `Boilerplates.tsx` settings mock (`.cx-switch`) | `Switch` (`hideLabel` + `text` for bare toggles) |
| Markdown renderer (fuller) | `plugins/ai-assistant/web/markdown.tsx` — **deleted** | `framework/react/components/Markdown.tsx` (`Markdown`, `safeHref`), CSS `.fx-md` |
| Markdown renderer (safe subset) | `plugins/systems-check/web/Markdown.tsx` — **deleted** | `Markdown compact` (`.fx-md--compact`); the `•` bullet it accepted is now in the shared grammar |
| `ParamField` (web console) | `apps/console-web/src/views/Wizards.tsx:84` — **deleted** | `LibraryParamField` (Forms.tsx) |
| `ParamField` (Android console) | `apps/console/.../views/WizardsView.kt:81` — **deleted** | `AxfLibraryParamField` (`axf-ui/components/Forms.kt`) |
| `ParamField` (Build Pilot) | `plugins/android-features/web/index.tsx:23` — read-only | adoption steps below |
| `LibraryParam` + `paramDefaultText/paramToJson/paramError` | `apps/console-web/src/api.ts` (now re-exports) and `apps/console/.../ConsoleRepo.kt` (`data class LibraryParam` with `defaultText/toJson/validate` — **deleted**, now a `typealias` to the kernel's) | `framework/core/library.ts` = `axf-kernel/.../library/LibraryParams.kt` (`LibraryParam`, `LibraryParams`) |

Android gained what it did not have: `AxfField`, `AxfSelectField` (DropdownMenu inside a field), `AxfChoiceGrid`,
`AxfNote`, `AxfSection`, `AxfLibraryParamField`, `AxfMarkdown` + `MarkdownParser` (same grammar as the web renderer:
headings, nested lists, task items, quotes, tables, rules, fenced code with Copy through `AxfActions.copy`, inline
code/bold/italic/strike/links). `AxfSwitch` and `AxfTextField` already existed (kit-dispatched) and are reused.
