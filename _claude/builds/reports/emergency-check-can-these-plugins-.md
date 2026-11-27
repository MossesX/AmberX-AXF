# Build report: emergency-check-can-these-plugins-

Report only. No plugin, code or data was changed or deleted.

**Result:** 38 plugins checked. All 38 folders exist; `notes-tasks` is not a plugin (no `plugin.json`).

- SAFE: 22
- MOVE FIRST: 11
- KEEP: 5 (ai-assistant, glossary-index, notes-tasks, voice-notes, snapshot-manager)

**Main report:** [`plugin-removal-check.md`](plugin-removal-check.md) has one table (plugin, verdict, what depends on it,
what to move), counts, the edits every removal PR needs, and a suggested removal order.

**Evidence:** group files under [`plugin-removal-check/`](plugin-removal-check/) (`01-changes` … `10-designers-wizards`),
one per step s1-s10, with file:line evidence. Where a group file's verdict is stricter, the stricter one wins.

**Calls made without Brett:**

- `glossary-index` is KEEP in the roll-up (its group file says SAFE): Brett's Nov 7 standing rule `glossary-catalog`
  runs through it on every build, so it stays until he retires that rule.
- The theme rows (`theme-manager`, `theme-editor`, `status-styles`) come from the s11 pass only, because `07-themes.md`
  was still being written when the roll-up was written.

**Needs Brett before any removal build:**

- Retire or keep the `glossary-catalog` rule.
- Keep or drop the `shipped-features` Postgres `ledger_*` tables.
- Export the live to-do store (`todo-manager`) and Brett's ask history (`build-breaker/data/asks.jsonl`) if he wants them kept.
- Keep or drop the `notes-tasks@1` one-store plan.
