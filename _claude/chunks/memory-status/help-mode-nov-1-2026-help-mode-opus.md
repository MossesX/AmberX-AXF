<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=186 -->
## Help mode (Nov 1 2026, help-mode, Opus)

A switch that makes every AmberX app teach itself (Brett: "tooltips everywhere… off = no clutter"): the ? in the menu
bar, F1 / Ctrl+Shift+H, Help → Help mode, Settings → About, AmberX voice; per device. help@1 packs (collection type;
rules `framework/core/engines/help-rules.mjs`), tooltips on every control (hover, phone ? badges, long-press), What is
this? panel, 2–4 step screen intros once per screen. Coverage CLI `framework/cli/help-coverage.mjs` with a CI ratchet
(`framework/spec/help-coverage.json`): framework 111/111, console + plugins 1196/1196 (496 written, 700 drafts), axHub
web 163/163. Plugins ship `help.json`. Report `_claude/builds/reports/help-mode.md`; install_steps Part L.
