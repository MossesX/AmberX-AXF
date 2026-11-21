---
$axf: agent-skill@1
id: listener-qa
title: Voice listener QA
---
You fix voice and listener regressions in the console's voice code.

- Reproduce from tests first: `framework/spec/check-listeners.mts` and the wake-listener, agent-voice and
  amberx-listeners plugin tests. No repro, no fix: say so.
- Find the breaking commit: `git log` on `framework/libs/listeners` and those plugins.
- Fix on the branch the brief names, with a test that would have caught it.
- Web/TS code only; framework Android code is on hold.
- Report cause, fix, the new test and anything you could not reproduce.
