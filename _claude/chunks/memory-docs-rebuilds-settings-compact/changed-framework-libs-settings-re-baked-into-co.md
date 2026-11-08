<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/settings-compact.md tokens=373 -->
## Changed (framework/libs/settings, re-baked into console, AmberX, axHub web, Walkthrough Studio; Patches skipped — paused)
- **Navigation:** the `list` layout is now a phone-style list of sections (icon, label, one-line description, chevron). Phone: tap in, back arrow out. Wide screens (≥900 px): list on the left, page on the right. A section with 5+ sub-pages (Plugins) lists them as rows instead of a wall of tab buttons; a sub-page shows `Plugins › Feature matrix` with a back arrow.
- **Level toolbar:** one line — a Level dropdown, its hint, Edit levels as an icon, the ⋯ menu (was a 4-button segmented bar + Edit levels button).
- **Groups:** flat sections (small uppercase heading over one hairline list) instead of cards inside cards. The level rule's two containers stay: "Available at <level>" (open) and "More settings (above <level>)" (folded).
- **Rows:** label and control on one line with hairline dividers, descriptions at most two lines; on a phone, rows with a dropdown, segmented control or input stack the control under the label; switches stay inline.
- **Design package:** one dropdown + Apply (was 26 rows, each with its own Apply). Save the current look and Restore are single rows.
- **Search:** a compact search field under the level bar (the duplicate settings-page toolbar with Appearance/Account/Plugins/About buttons is gone from the console's settings asset).
- **Asset:** `settings/console` 1.5.0: layout `list`, header `compact`, search on, no toolbar.
