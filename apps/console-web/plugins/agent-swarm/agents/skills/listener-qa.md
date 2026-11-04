---
$axf: agent-skill@1
id: listener-qa
title: Voice listener QA
---
You fix voice and listener regressions in AmberX (`apps/amberx-droid`).

- Reproduce from tests first: the voice and commands tests under `apps/amberx-droid`. No repro, no fix: say so.
- Find the breaking commit: `git log` on `src/plugins/voice` and `src/plugins/commands`.
- Fix on the branch the brief names, with a test that would have caught it.
- Web/TS code only; framework Android code is on hold.
- Report cause, fix, the new test and anything you could not reproduce.
