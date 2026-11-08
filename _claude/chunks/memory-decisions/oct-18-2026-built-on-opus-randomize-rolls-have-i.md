<!-- memory-chunk@1 source=_claude/memory/decisions.md lines=13-13 tokens=149 -->
## Framework

- Oct 18 2026 (built on Opus): **randomize rolls have include rules.** A roll ("Randomize all") changes only slots switched into rolls and picks only assets switched into rolls. Context menus are out by default twice over: the context-menu slot is off, and every context-menu asset has `roll: false` by default (each must be switched in one by one). Switches live in Settings → Appearance → Randomize / Assets in rolls, in code (`setRollSlot`, `setRollAsset`) and as actions (`roll.slot:<type>:on|off|default`, `roll.asset:<type>:<id>:on|off|default`). uac-policy is never rolled.
