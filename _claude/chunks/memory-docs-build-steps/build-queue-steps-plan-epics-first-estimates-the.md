<!-- memory-chunk@1 source=_claude/memory/docs/build-steps.md tokens=437 -->
## Build-queue steps (plan epics; first estimates, they had none)

| Step | Estimate | Steps | Model | Note |
|---|---|---|---|---|
| `x.modules` Module system on web + python | 4 h | 8 | Fable | |
| `x.state` State, cache, events, flags, config, migrations on web | 4 h | 8 | Fable | |
| `x.uikits` UI-kit switching + fallback on web | 3.5 h | 7 | Opus | |
| `x.plugins` Plugin runtime (PACK kind real, MODULE/SCRIPT stay placeholders) | 5 h | 10 | Fable | |
| `x.work` Background work scheduler | 3 h | 6 | Fable | |
| `x.session` Session, principal, audit log (+ axHub provider) | 3.5 h | 7 | Opus | |
| `x.libs.core` admin, accounts, profile, billing real | 6 h | 12 | Opus | Play Billing parked as its own feature |
| `x.python.port` Python / PyQt6 port | 1 d | 17 | Fable | |
| `x.engine.uiport` import-ui on a real library | 2.5 h | 5 | Opus | |
| `x.engine.dev` live reload end to end | 2 h | 4 | Opus | |
| `x.console.repo` console in its own repo | 2.5 h | 5 | Opus | **step 1 needs Brett** (he said "not yet"; also picks tag-tarball vs submodule) |
| `x.deploy.console` | 30 min | whole | Opus | **needs Brett**: confirm the 5-minute cron on the VPS, then mark done |
| `x.showcase.packs` | 3 h | 6 | Opus | step 5: Brett checks the packs on his phone |
| `x.lib.media/location/editor/ai/vps/github/notifications/sensors/files/charts` | 3 h each | 6 each | Opus | scaffold → 3 specific pieces → demo app → tests/status |
| `x.assets.designer` / `.browser` / `.templates` | 1 d / 5 h / 7 h | mirror the pending items | Fable | |
| `x.plugins.manager` | 30 min | whole | Fable | already built (pending `plugin-manager` complete): mark the epic built |

**Time left on the queue: Fable 6.5 d · Opus 6 d** (`build-queue.mjs --check-steps`).
