# UI Review → ui-review-item@1 migration (dry run)

Data folder: a copy of the live console's `.axf-console/plugins/ui-review` (VPS, 2026-11-01T02:19Z); nothing was written to the live folder

- Queue items: 6 (design-pack decisions: 0), queue groups: 5
- Screenshots: 10, screenshot groups: 1
- Records changed: 17
- Still not conforming after the migration: 0

| Store | Id | Name | What was filled / changed |
|---|---|---|---|
| queue | `r-20261101-itzed01` | Builds page: Builds + Steps views, harvest dialog, draft bar, live progress bars (Urgent) | createdAt from submittedAt/takenAt; name from title; source cli → claude-code; submittedBy filled; group "urgent-builds - 2026-11-01"; status waiting → pending; section = screen |
| queue | `r-20261101-ksry601` | Watch live: link on running builds + approval details, floating window (desktop) / full-screen sheet (phone) | createdAt from submittedAt/takenAt; name from title; source cli → claude-code; submittedBy filled; group "watch-live - 2026-11-01"; status waiting → pending; section = dialog |
| queue | `r-20261101-070d03ce` | UI Review → Screenshots tab | createdAt from submittedAt/takenAt; name from title; source api → console; submittedBy filled; group "shots-tab - 2026-11-01"; status waiting → pending; section = screen |
| queue | `r-20261101-396ffb92` | Expandable approval rows (caret far right, details in place) | createdAt from submittedAt/takenAt; name from title; source cli → claude-code; submittedBy filled; group "approval-expand - 2026-11-01"; status waiting → pending; section = banner |
| queue | `r-20261101-657d9917` | App menu: Waiting for approvals rows expand in place (caret far right) | createdAt from submittedAt/takenAt; name from title; source cli → claude-code; submittedBy filled; group "approval-expand - 2026-11-01"; status waiting → pending; section = menu |
| queue | `r-20261101-dab86343` | Screenshots: named, timestamped groups (group list, open group, rename / select + move) | createdAt from submittedAt/takenAt; name from title; source build → headless; submittedBy filled; group "shot-groups - 2026-11-01"; status waiting → pending; section = screen |
| groups | `g-20261101-a8a5b0fb` | Breakroom check - 2026-10-31 20:29 | shot-group@1 → ui-review-group@1 |
| screenshots | `s-r20261101bb8137b3-1` | Breakroom check: Breakroom (Crew) · Breakroom | createdAt from submittedAt/takenAt; name from title; source check → claude-code; submittedBy filled; group "Breakroom check - 2026-10-31 20:29" |
| screenshots | `s-r20261101bb8137b3-2` | Breakroom check: Breakroom (Crew) · Breakroom | createdAt from submittedAt/takenAt; name from title; source check → claude-code; submittedBy filled; group "Breakroom check - 2026-10-31 20:29" |
| screenshots | `s-r20261101f3bdd344-1` | Breakroom check: Group chat · Group chat | createdAt from submittedAt/takenAt; name from title; source check → claude-code; submittedBy filled; group "Breakroom check - 2026-10-31 20:29" |
| screenshots | `s-r20261101f3bdd344-2` | Breakroom check: Group chat · Group chat | createdAt from submittedAt/takenAt; name from title; source check → claude-code; submittedBy filled; group "Breakroom check - 2026-10-31 20:29" |
| screenshots | `s-r2026110160afbe0d-1` | Breakroom check: Agent manager grid · Agent manager | createdAt from submittedAt/takenAt; name from title; source check → claude-code; submittedBy filled; group "Breakroom check - 2026-10-31 20:29" |
| screenshots | `s-r2026110160afbe0d-2` | Breakroom check: Agent manager grid · Agent manager | createdAt from submittedAt/takenAt; name from title; source check → claude-code; submittedBy filled; group "Breakroom check - 2026-10-31 20:29" |
| screenshots | `s-r20261101d3b650ce-1` | Breakroom check: ID cards gallery · Id cards | createdAt from submittedAt/takenAt; name from title; source check → claude-code; submittedBy filled; group "Breakroom check - 2026-10-31 20:29" |
| screenshots | `s-r20261101d3b650ce-2` | Breakroom check: ID cards gallery · Id cards | createdAt from submittedAt/takenAt; name from title; source check → claude-code; submittedBy filled; group "Breakroom check - 2026-10-31 20:29" |
| screenshots | `s-r202611018dd098c2-1` | Breakroom check: Agent ID card (Kotlin Kat) · Agent id card | createdAt from submittedAt/takenAt; name from title; source check → claude-code; submittedBy filled; group "Breakroom check - 2026-10-31 20:29" |
| screenshots | `s-r202611018dd098c2-2` | Breakroom check: Agent ID card (Kotlin Kat) · Agent id card | createdAt from submittedAt/takenAt; name from title; source check → claude-code; submittedBy filled; group "Breakroom check - 2026-10-31 20:29" |
