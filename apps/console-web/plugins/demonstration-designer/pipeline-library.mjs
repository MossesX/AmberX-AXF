/**
 * The library of ready-made pipeline demos (pipeline-demo@1), one per pipeline type. Each is a guided walkthrough:
 * narrated chapters, the console screen each moves to, and the behind-the-scenes lines a real run of that pipeline
 * prints (orchestrator, model picks, step splits, agent log, git, tests, axHub). The lines are written from what the
 * real tools print, so a replay reads like the real thing; a live run adds the real output of the chapter's probes
 * (pipelines.mjs PROBES) on the test-sandbox data. Built-ins can't be deleted; "Save as copy" makes them editable.
 */
import { normalizeDemo } from './pipelines.mjs';

const ev = (at, kind, text) => ({ at, kind, text });

const RAW = [
  {
    id: 'voice-to-app', name: 'Voice to app', type: 'voice-to-app',
    summary: 'Say an idea out loud and watch it become an Android app: voice note, build plan, steps, UI Review, landing.',
    voice: ['voice to app', 'say an idea', 'android app'],
    chapters: [
      { id: 'idea', title: 'Say the idea', view: 'voice-notes', say: 'It starts with a sentence. You say the idea out loud; the voice note is transcribed and turned into a build request with your exact words kept on top.', live: ['axhub-ping'], events: [
        ev(0.4, 'agent', 'voice-notes: recording 00:07 · 16 kHz mono'),
        ev(1.6, 'agent', 'transcribe: "a habit tracker that nags me at nine with a streak counter"'),
        ev(2.6, 'axhub', 'POST /api/notes {kind: voice, reason: {title: "Voice idea", description: "build request from a voice note"}} → 201'),
        ev(3.8, 'orchestrator', 'pending: new build habit-tracker-streak-nag (origin: voice, build-origin@1 keeps the words verbatim)'),
      ] },
      { id: 'plan', title: 'The plan', view: 'build-orchestrator', say: 'The orchestrator reads the request, picks the right model for each part, and splits the work into short steps that each fit in ten minutes.', live: ['model-pick', 'step-split'], events: [
        ev(0.3, 'orchestrator', 'plan habit-tracker-streak-nag: 5 steps, ~45 min, target amberx-droid'),
        ev(1.2, 'split', 's1 data model + streak rules · s2 reminder at 21:00 · s3 screens · s4 tests · s5 report + PR'),
        ev(2.1, 'model', 's1 mentions "data model" → Fable (foundation work)'),
        ev(2.7, 'model', 's2..s5 → Opus (default)'),
        ev(3.6, 'orchestrator', 'queue: claimed slot 2 of 4 on account max-b · branch claude/habit-tracker-streak-nag'),
      ] },
      { id: 'build', title: 'The build runs', view: 'builds', say: 'Now the agent works through the steps. Each step is committed and ticked, so if the session dies, the next one picks up exactly where it stopped.', live: ['git-log', 'agent-slots'], events: [
        ev(0.5, 'agent', 'session 7f3c started · Opus · rules brief loaded (4.1 kB)'),
        ev(1.5, 'agent', 'write apps/habit/src/streak.kt (+142)'),
        ev(2.5, 'git', 'commit 3a9e1c2 "Streak rules and data model" · push origin claude/habit-tracker-streak-nag'),
        ev(3.2, 'orchestrator', 'step s1 done (1/5)'),
        ev(4.4, 'agent', 'write apps/habit/src/Reminder.kt (+88) · AlarmManager at 21:00 local'),
        ev(5.6, 'git', 'commit 51bd07e "Nine o\'clock nag" · push'),
        ev(6.1, 'orchestrator', 'step s2 done (2/5)'),
      ] },
      { id: 'tests', title: 'Tests', view: 'builds', say: 'Tests run on the shared runner. They are green before anything is called ready.', live: ['plugin-test'], events: [
        ev(0.4, 'test', 'gradle :habit:test · 23 tests'),
        ev(2.0, 'test', '✓ streak resets after a missed day · ✓ reminder fires at 21:00 · ✓ 21 more'),
        ev(2.8, 'test', 'check-theme: 0 literals · check-controls: framework controls only'),
      ] },
      { id: 'review', title: 'UI Review', view: 'ui-review', say: 'The screens go to UI Review with phone and desktop shots. You approve them, or say what to change.', events: [
        ev(0.4, 'agent', 'axf shot habit-home.png --app amberx-droid --screen home (phone 412×915)'),
        ev(1.4, 'axhub', 'POST /api/ui-review {kind: screen, shots: 2, reason: {title: "Habit tracker screens"}} → queued'),
        ev(2.6, 'orchestrator', 'waiting on UI Review: 1 item'),
      ] },
      { id: 'land', title: 'It lands', view: 'shipped-features', say: 'Approved, the merge queue lands it on main, the APK is built, and Shipped features says what is new. That was one sentence to a working app.', events: [
        ev(0.4, 'git', 'merge queue: PR #—  checks green → squash into main'),
        ev(1.6, 'test', 'android.yml: assembleRelease ✓ app-release.apk 4.2 MB'),
        ev(2.6, 'orchestrator', 'build habit-tracker-streak-nag → complete · shipped manifest rev 1'),
      ] },
    ],
  },
  {
    id: 'add-feature', name: 'Add a feature to an app', type: 'add-feature',
    summary: 'An existing app gets a new feature: the agent reads only what it needs, changes it, tests it, and lands it.',
    voice: ['add a feature', 'new feature'],
    chapters: [
      { id: 'ask', title: 'The ask', view: 'build-orchestrator', say: 'Here is an app that already works. We ask for one more thing: export the list as a spreadsheet.', live: ['sandbox-builds'], events: [
        ev(0.5, 'orchestrator', 'new build notes-export-csv (project: test-sandbox) · 3 steps'),
        ev(1.4, 'model', 'no foundation words → Opus for every step'),
      ] },
      { id: 'read', title: 'Reading the code', view: 'builds', say: 'The agent does not read the whole repository. It reads the few files the brief lists, so it is fast and cheap.', events: [
        ev(0.4, 'agent', 'read apps/notes/web/list.tsx (212 lines)'),
        ev(1.2, 'agent', 'grep "export function rows" apps/notes → 1 hit'),
        ev(2.0, 'agent', 'plan: add toCsv(rows) in model.ts, an Export button in the list toolbar'),
      ] },
      { id: 'change', title: 'The change', view: 'builds', say: 'The change is small and goes on its own branch. Every step is a commit you can see.', live: ['git-status'], events: [
        ev(0.6, 'agent', 'edit apps/notes/web/model.ts (+24) · edit list.tsx (+9)'),
        ev(1.8, 'git', 'commit 0c41d9a "Export notes as CSV" · push origin claude/notes-export-csv'),
        ev(2.4, 'orchestrator', 'step s1 done (1/3)'),
      ] },
      { id: 'verify', title: 'Checked and shipped', view: 'shipped-features', say: 'Tests, theme and control checks pass, the screenshot goes to UI Review, and the feature lands.', live: ['theme-check'], events: [
        ev(0.4, 'test', 'notes self-test: 31 checks passed'),
        ev(1.4, 'test', 'check-theme ✓ · check-controls ✓ · check-toolbars ✓'),
        ev(2.4, 'orchestrator', 'build notes-export-csv → complete'),
      ] },
    ],
  },
  {
    id: 'skin-swap', name: 'Skin swap across the whole app', type: 'skin-swap',
    summary: 'One skin change restyles every screen at once, because every colour, size and font is a token.',
    voice: ['skin swap', 'change the skin', 'new theme'],
    chapters: [
      { id: 'before', title: 'Before', view: 'home', say: 'This is the console as it looks now. Every colour, size, spacing and font on it comes from a skin.', events: [
        ev(0.6, 'orchestrator', 'active skin: axf-default · 214 tokens'),
      ] },
      { id: 'pick', title: 'Pick a skin', view: 'theme-manager', say: 'We pick another skin. Nothing is rebuilt: the tokens are swapped while the app runs.', events: [
        ev(0.4, 'agent', 'theme-manager: apply skin "midnight-amber"'),
        ev(1.2, 'axhub', 'POST /api/control {set: skin, value: midnight-amber, reason: {title: "Skin swap demo"}} → 200'),
        ev(2.0, 'agent', 'tokens: 214 swapped · accent, radius, type scale and density all from the new skin'),
      ] },
      { id: 'after', title: 'Every screen follows', view: 'builds', say: 'Every screen follows at once: builds, reviews, settings. That is why the checks forbid any colour written by hand.', live: ['theme-check'], events: [
        ev(0.4, 'focus', 'walk: builds → ui-review → settings'),
        ev(1.6, 'test', 'check-theme: 0 raw colours in 1,412 files'),
      ] },
      { id: 'back', title: 'And back', view: 'theme-manager', say: 'One more move puts the old skin back. The swap is safe to show anywhere.', events: [
        ev(0.5, 'axhub', 'POST /api/control {set: skin, value: axf-default, reason: {title: "Skin swap demo: restore"}} → 200'),
      ] },
    ],
  },
  {
    id: 'parallel-split', name: 'Parallel split build', type: 'parallel-split',
    summary: 'A big build split into parts that run in several agent slots at the same time, then come together.',
    voice: ['parallel', 'split build', 'several slots'],
    chapters: [
      { id: 'big', title: 'A big build', view: 'build-orchestrator', say: 'This build is too big for one session. The orchestrator splits it into parts that do not touch the same files.', live: ['step-split'], events: [
        ev(0.4, 'orchestrator', 'build console-app: 14 steps, ~2.5 h'),
        ev(1.2, 'split', 'part 1 native bridge (4) · part 2 floating window (4) · part 3 mic (3) · part 4 console side (3)'),
        ev(2.2, 'split', 'file sets disjoint ✓ · part 4 waits on parts 1..3 for the merge'),
      ] },
      { id: 'slots', title: 'Slots at once', view: 'builds', say: 'Three parts start at once, each in its own slot, on its own branch, with its own model.', live: ['agent-slots', 'model-pick'], events: [
        ev(0.3, 'orchestrator', 'slot 1 ← part 1 (Fable: "bridge contract") · slot 2 ← part 2 (Opus) · slot 3 ← part 3 (Opus)'),
        ev(1.0, 'agent', '[slot 1] read framework/core/bridge.ts'),
        ev(1.4, 'agent', '[slot 2] write floating/Window.kt (+120)'),
        ev(1.9, 'agent', '[slot 3] write mic/Capture.kt (+77)'),
        ev(2.8, 'git', '[slot 2] commit 9e2f1a0 · push claude/console-app-part-2'),
        ev(3.5, 'git', '[slot 1] commit 4b77c3e · push claude/console-app-part-1'),
        ev(4.2, 'git', '[slot 3] commit d05aa61 · push claude/console-app-part-3'),
      ] },
      { id: 'join', title: 'They come together', view: 'builds', say: 'When the first three are done, the last part starts and joins them. Parallel where it can be, in order where it must be.', events: [
        ev(0.5, 'orchestrator', 'parts 1..3 done → slot 1 ← part 4'),
        ev(1.6, 'test', 'part 4: console self-test 412 checks passed'),
        ev(2.6, 'orchestrator', 'build console-app → complete (2 h 9 min wall, 3 slots)'),
      ] },
    ],
  },
  {
    id: 'auto-fix', name: 'Fix a failing build automatically', type: 'auto-fix',
    summary: 'A build goes red. The fixer reads the log, finds the cause, fixes it and lands it, with nobody asked.',
    voice: ['fix a failing build', 'auto fix', 'broken build'],
    chapters: [
      { id: 'red', title: 'It goes red', view: 'builds', say: 'Something broke on main. The check is red and the console says so at once.', events: [
        ev(0.3, 'error', 'CI main: test-console ✗ (exit 1) after merge of PR #—'),
        ev(1.1, 'orchestrator', 'main-build-status: red · opening a fix build'),
      ] },
      { id: 'read', title: 'Reading the log', view: 'build-breaker', say: 'The fixer reads the failing log and finds the one line that matters.', events: [
        ev(0.4, 'agent', 'fetch job log 41.2 kB · grep "✗|Error"'),
        ev(1.4, 'error', 'TypeError: rows.map is not a function (plugins/notes/web/list.tsx:88)'),
        ev(2.2, 'agent', 'cause: rows can be undefined before the first load'),
      ] },
      { id: 'fix', title: 'The fix', view: 'builds', say: 'A one-line fix on its own branch, with a test that would have caught it.', live: ['git-log'], events: [
        ev(0.4, 'agent', 'edit list.tsx: (rows ?? []).map · add test "renders before load"'),
        ev(1.4, 'test', 'notes self-test: 32 checks passed'),
        ev(2.0, 'git', 'commit 7c0de11 "Notes list renders before the first load" · push'),
      ] },
      { id: 'green', title: 'Green again', view: 'shipped-features', say: 'The merge queue lands it and main is green. Nobody had to stop what they were doing.', events: [
        ev(0.6, 'test', 'CI main: test-console ✓'),
        ev(1.4, 'orchestrator', 'main-build-status: green · fix build complete'),
      ] },
    ],
  },
  {
    id: 'new-project', name: 'New project from a template', type: 'new-project',
    summary: 'A whole new project from a template: folders, settings, first builds and a working app, in a minute.',
    voice: ['new project', 'from a template', 'template'],
    chapters: [
      { id: 'wizard', title: 'The wizard', view: 'project-wizard', say: 'We start a new project. Pick a template, give it a name, and that is the whole form.', events: [
        ev(0.4, 'agent', 'project-wizard: template "android-app" · name "Field Notes"'),
        ev(1.4, 'axhub', 'POST /api/projects {id: field-notes, reason: {title: "New project from a template"}} → 201'),
      ] },
      { id: 'scaffold', title: 'Scaffolding', view: 'project-wizard', say: 'Behind the scenes the project gets its folders, its build profile, and its first builds queued.', live: ['sandbox-builds'], events: [
        ev(0.3, 'agent', 'mkdir /projects/field-notes/{_claude,_data} · project.manifest.json (project-manifest@1)'),
        ev(1.2, 'orchestrator', 'profile field-notes created · 3 starter builds pending'),
        ev(2.0, 'git', 'init · first commit "Field Notes from android-app"'),
      ] },
      { id: 'first', title: 'First build', view: 'builds', say: 'The first build runs right away, so the new project has a working app before you have finished your coffee.', events: [
        ev(0.4, 'model', 'starter steps → Opus'),
        ev(1.4, 'test', 'starter tests: 12 passed'),
        ev(2.4, 'orchestrator', 'field-notes: 1 complete, 2 pending'),
      ] },
    ],
  },
  {
    id: 'approval-flow', name: 'The approval flow', type: 'approval-flow',
    summary: 'Nothing lands without a yes: a veto stops it, an approval by voice lets it through.',
    voice: ['approval', 'approve by voice', 'veto'],
    chapters: [
      { id: 'ask', title: 'Asking first', view: 'build-orchestrator', say: 'Some moves need a yes: a bigger model, a cost, a change outside the plan. The build stops and asks.', live: ['model-pick'], events: [
        ev(0.4, 'model', 'step s3 asks Fable: "cross-app protocol" (pinned Opus)'),
        ev(1.2, 'axhub', 'POST /api/approvals {kind: model-upgrade, reason: {title: "Raise s3 to Fable", description: "cross-app protocol"}} → pending'),
        ev(2.0, 'orchestrator', 'build waits on 1 approval'),
      ] },
      { id: 'veto', title: 'A veto', view: 'build-orchestrator', say: 'Say no, and it stops. The build goes back with your reason, nothing is spent.', events: [
        ev(0.5, 'axhub', 'approval 1 → veto ("keep it on Opus")'),
        ev(1.3, 'orchestrator', 's3 stays on Opus · note added'),
      ] },
      { id: 'voice', title: 'Approve by voice', view: 'build-orchestrator', say: 'Or just say yes. "Approve the upgrade" to AmberX is the same as tapping the button, and it is recorded who said it.', events: [
        ev(0.4, 'agent', 'AmberX heard: "approve the upgrade" → action approvals.approve:2'),
        ev(1.2, 'axhub', 'approval 2 → approved (via voice, by the project owner)'),
        ev(2.0, 'orchestrator', 's3 raised to Fable · switch recorded on the build'),
      ] },
      { id: 'land', title: 'Then it lands', view: 'shipped-features', say: 'With every yes in place the build lands, and the approvals stay on its record.', events: [
        ev(0.6, 'orchestrator', 'build complete · approvals: 1 veto, 1 approve'),
      ] },
    ],
  },
];

/** The built-in demos, normalised (builtIn = true). */
export const LIBRARY = Object.freeze(RAW.map((d) => normalizeDemo({ ...d, builtIn: true, updatedAt: '2026-11-13' })));
export const libraryDemo = (id) => LIBRARY.find((d) => d.id === id) ?? null;
