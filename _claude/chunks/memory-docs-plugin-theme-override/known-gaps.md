<!-- memory-chunk@1 source=_claude/memory/docs/plugin-theme-override.md tokens=175 -->
## Known gaps

- Derived tokens declared on `:root` from other tokens (`--fx-card-pad`, `--fx-tab-py/px` = `calc(var(--fx-space) * k)`)
  are resolved at the root, so overriding `--fx-space` doesn't move them; they are separate tokens in the registry.
  Component-engine variables (button, slider, …) aren't overridden yet.
- UI a plugin renders into a portal outside its roots (`document.body`), its banners and its slot content don't carry the
  attribute (banners have their own look@1 in Banner settings; wrapping slots / banners would break their hosts' child
  selectors).
- No per-level (Simple / Basic / Developer / Administrator) placement for the panel's tokens.
- Android: none (on hold).
