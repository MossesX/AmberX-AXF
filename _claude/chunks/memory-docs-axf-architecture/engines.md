<!-- memory-chunk@1 source=_claude/memory/docs/axf-architecture.md lines=41-53 tokens=255 -->
## Engines

| Engine | Input asset(s) | Output |
| --- | --- | --- |
| Theme | `color-theme`, `style-theme` | web: `--fx-*` CSS variables · android: `ThemeTokens` (colors incl. derived extended tokens, style tokens) |
| Layout | `layout` (+ optional `mobile` block) | web: CSS grid · android: `CompiledLayout` per window class (COMPACT/MEDIUM/EXPANDED) |
| Component style | `button`, `slider`, `container`, `dialog`, `popup`, `context-menu` | variables/attributes · `ComponentStyles` |
| User account control | `uac-policy` | role → permissions (inheritance, wildcards), hide/disable gating |
| Context menu | `context-menu` | per-target menus with `{payload}` substitution |
| Action | menus, toolbars, shortcuts | command bus, standard vocabulary, interceptors |
| Module / extension | modules | dependency-ordered lifecycle, typed extension points, placeholders |
| State / query | app code | `AxfStore` (reducer, middleware, undo, persistence), `QueryClient` (stale-while-revalidate, dedup, retries, invalidation) |
