<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=114 -->
## Status (as of Oct 21 2026)

- **Designed assets at init (Oct 20 2026, Fable; for Build Pilot's designers):** `init` takes `assets: [asset@1 …]` (`checkDesignedAssets`: validated like framework assets, own ids only — a framework starter's id is refused —, ≤ 40, ≤ 200 KB each) written into the new app's assets folder, and `slots` may pick them (`checkSlotPicks(slots, template, designed)`); engine-rpc/console `init` pass `hidden` and `assets` through.
