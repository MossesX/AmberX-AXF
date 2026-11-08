<!-- memory-chunk@1 source=_claude/memory/docs/project-guide.md tokens=182 -->
## Related repos

- **`MossesX/axHub`**: standalone connector hub at `axhub.amberxai.com`. axHub's server core never depends on AXF; its UI may be built on AXF (axHub decision #93, Oct 23 2026), as static files the hub only hosts. AXF plugs in from its side via `lib-hub` (protocol defined by axHub: AXPP) and the `axhub-adapter-axf` plugin, which lives in **this** repo. axHub's step 3 proxies this console's `/mcp` as its first downstream service.
- **`MossesX/studiox`**: AmberX AI Studio (Next.js), an earlier, separate `@axf/core` line. It does not consume this repo.
- **`MossesX/amberx`**: earlier PyQt6 desktop AmberX framework (dormant). This repo's planned `python` port (`x.python.port`) is separate from it.


---
