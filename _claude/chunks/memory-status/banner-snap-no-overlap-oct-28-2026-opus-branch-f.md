<!-- memory-chunk@1 source=_claude/memory/STATUS.md lines=175-175 tokens=130 -->
## Status (as of Oct 21 2026)

- **Banner snap, no overlap (Oct 28 2026, Opus; branch `fix/banner-snap`):** banner grid sides are `minmax(max-content, 1fr)`, center `minmax(min-content, auto)` with the search bar shrinking to 12 × space; a full banner scrolls sideways with scroll snap (no clipping, no overlap; verified at 412 px and 1280 px); banner popups sit in the flow; toolbar + menubar snap. Copied into console-web, axhub-web, patches-web, amberx-droid, walkthrough-studio baked copies (demo needs its re-bake).
