<!-- memory-chunk@1 source=_claude/memory/docs/plugin-theme-override.md lines=69-80 tokens=243 -->
## How a Fable contract (plugin-theme@1) would replace it

1. Contract: keep `{ on, tokens }` under `axf.plugin.<id>.look` (add `$axf: "plugin-theme@1"` when written, read the
   frame-less shape as v0), the token registry moves to `framework/schemas/` (one source for both ports), value rules
   become the contract's normalizer.
2. Scoped engine: `core/engines/plugintheme.ts` + Kotlin twin replacing `normalizePluginLook` / `pluginThemeCss`,
   fixture `spec/fixtures/plugin-theme.json` (cases from `check-plugintheme.mts`); it can also re-derive card / tab
   padding and component variables inside the scope.
3. React layer: the runtime marks plugin roots itself (instead of the console's `withPluginTheme` wrapper) and the
   lib's UI becomes the editor on top of the engine. The Opus version is removed by deleting `framework/libs/plugintheme`
   and the `withPluginTheme` / `pluginThemeLibrary` lines in `apps/console-web/src/App.tsx`; stored settings stay valid.
