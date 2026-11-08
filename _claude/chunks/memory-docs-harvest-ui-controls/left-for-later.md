<!-- memory-chunk@1 source=_claude/memory/docs/harvest/ui-controls.md lines=142-151 tokens=170 -->
## Left for later

- **Kits overriding the new kinds:** `AxfComponents` has no slot for SELECT_FIELD / CHOICE_GRID / NOTE / SECTION /
  LIBRARY_PARAM / MARKDOWN yet (same as the existing MARKDOWN, TABLE, …); adding slots is additive.
- `framework/libs/settings` `multi_choice` still uses native checkboxes (a checkbox, not a switch: fine; a shared
  `Checkbox` is a small follow-up).
- Build Pilot `Sheet`, `FeatureList` and the designers stay app-specific (they were not in this group).
- Console `LibraryTemplates.tsx` renders template params as plain inputs (not library@1 `LibraryParam`s with types);
  it could use `LibraryParamField` once library templates declare types.
