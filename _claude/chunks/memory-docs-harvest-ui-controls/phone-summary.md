<!-- memory-chunk@1 source=_claude/memory/docs/harvest/ui-controls.md tokens=285 -->
## Phone summary

- The framework now owns the form kit every app and plugin had copied: **Switch, Field, TextField, SelectField,
  ChoiceGrid, Note, Section, Markdown, LibraryParamField** — same names, props and behaviour on web (React) and
  Android (Compose), theme tokens only, sized by the Spacing choice, accessible.
- New cross-port contract **library@1 parameters** (`core/library.ts` = Kotlin `LibraryParams`, fixture
  `library-params.json`); the CLI installer, the web wizard and the Android wizard now agree by test (801 checks).
- Switched to the framework versions: plugin-switches, theme-manager and the settings library toggles; the
  systems-check What's new and ai-assistant Markdown renderers (both copies deleted); the console and Android
  console `ParamField`s (deleted; the Android console's own `LibraryParam` model is now the kernel's).
- Every control shows in the web Components view / Element explorer and the Android Component gallery / explorer.
- No component-style engine input was needed: nothing here has asset-level styling, so `asset-types.json`,
  the engines and the component fixtures are untouched.
