// Hero video 1 (step s5): talk an Android app into existence on your way to work.
export default {
  id: 'commute', step: 's5', kind: 'hero', title: 'Talk an Android app into existence on your way to work',
  app: 'amberx-droid', viewport: 'phone', skin: 'atelier',
  hook: 'Speak it on the train. Install it at your desk.',
  facts: [
    'android-compose template: framework/templates/android-compose (Kotlin + Jetpack Compose on the AXF Android port).',
    'Libraries named on screen are real entries in framework/catalog/libraries.json: lib-hubsync, lib-hubstore, lib-notifications, lib-work, lib-lock, lib-voice, lib-datagrid.',
    'Skins: atelier and ledger exist in framework/assets/skin.',
    'Staged: the library matrix screen, voice-to-app assembly, the time-tracker APK itself.',
  ],
  chapters: [
    {
      id: 'need', title: 'The need',
      scenes: [
        { camera: 'story', say: "Seven forty-five. Jordan's new job wants hours logged per project, by Friday, and the company's tool is a spreadsheet nobody can open on a phone.", shot: 'Morning street, Jordan walking to the train, a calendar notification about timesheets.' },
        { camera: 'story', say: "Jordan has a twenty-five minute train ride. That's enough time to build the app instead.", shot: 'Train seat; Jordan takes out the phone, earbuds in.' },
        { say: "Hey, I'm Amber. Everything in this video marked Preview is something we're still finishing. Everything else is running today. Let's go.", shot: 'AmberX Home on the phone; a small Preview legend fades in at the corner.' },
      ],
    },
    {
      id: 'describe', title: 'Say it in plain English',
      scenes: [
        { say: "Jordan just talks. I need a time tracker for work. Projects, a big start and stop button, today's hours, and a weekly total I can send to my manager on Friday.", shot: 'Voice overlay LISTENING, the live transcript filling in word by word.' },
        { say: "Plan Studio writes it up as a plan: two screens, one data set for time entries, a weekly summary, and a reminder at five if a timer is still running.", shot: 'Plan Studio on the phone: the new time-tracker plan with its screens, data and features.', app: 'console-web' },
      ],
    },
    {
      id: 'matrix', title: 'Pick from the library matrix',
      scenes: [
        { staged: true, say: "Now the library matrix, shown here as a preview. Every feature Jordan asked for is a row, and every pre-built AXF library that covers it is a tick. Nothing here is written from scratch.", shot: 'Staged library matrix: rows Projects, Timer, Weekly total, Reminder, Sync; columns are libraries; ticks fill in.' , mock: 'matrix' },
        { staged: true, say: "Storage and sync come from the hub libraries, so the back end is handled. The weekly table is the data grid. The five o'clock reminder is notifications plus background work. And the app lock keeps the hours private.", shot: 'Matrix ticks highlighted one by one: lib-hubstore, lib-hubsync, lib-datagrid, lib-notifications, lib-work, lib-lock.' , mock: 'matrix' },
        { say: "Jordan doesn't want the export to a spreadsheet yet. Untick it, and the estimate drops before anything is spent.", shot: 'Feature matrix of the build; untick Export; the minutes and cost totals shrink.', app: 'console-web' },
      ],
    },
    {
      id: 'assemble', title: 'AmberX assembles it',
      scenes: [
        { say: "Approve the plan, and it becomes a build. The orchestrator splits it into short steps and the crew starts working while the train is still two stops out.", shot: 'Approval card on the phone; tap Approve; the build appears in the orchestrator Queue.' },
        { say: "The app starts from the real Android template: Kotlin, Jetpack Compose, the framework wired in, and a default asset in every slot. The libraries snap in on top.", shot: 'Terminal clip: template init android-compose, then the project tree with the library modules listed.', app: 'console-web' },
        { staged: true, say: "The screens come together from framework parts. This assembly view is a preview: the start button, the project picker, today's list and the week grid, already in Jordan's look.", shot: 'Staged assembly view: the two screens building up part by part.' , mock: 'app' },
      ],
    },
    {
      id: 'look', title: 'One look, saved for next time',
      scenes: [
        { say: "Every colour, font and corner comes from tokens, so the look is an asset you can swap. Jordan tries Atelier, then Ledger, and the whole app changes at once.", shot: 'Skin picker: atelier then ledger applied; every screen follows.' },
        { say: "Jordan saves that look as a personal asset. The next app gets it for free, and every app built with it will look like part of the same family.", shot: 'Save look as asset; it appears in the asset list.' },
      ],
    },
    {
      id: 'arrive', title: 'Ready at the desk',
      scenes: [
        { camera: 'story', say: "Eight ten. Jordan steps off the train and walks into the office.", shot: 'Station platform, then the office door.' },
        { staged: true, say: "The finished app is waiting in axHub. Tap install, and the APK is on the phone. This install and the running app are a preview of where we're heading.", shot: 'Staged: axHub Apps showing Time Tracker; tap Install; the Android install sheet; the app icon on the home screen.' },
        { staged: true, say: "Jordan taps Client Website, taps start, and the first billable minutes of the day are ticking. The hours sync to the hub, so the laptop sees them too.", shot: 'Staged: the time tracker running, a project selected, timer counting, a week grid below.' },
        { say: "You talked an app into existence on your way to work. Join the waitlist, and tell AmberX what you need tomorrow morning.", shot: 'End card: the one-line pitch and the waitlist link.' },
      ],
    },
  ],
  short: {
    title: 'Talk an Android app into existence (60 seconds)',
    scenes: [
      { camera: 'story', say: "Jordan needs a time tracker for work, and has one train ride to get it.", shot: 'Train seat, phone out.' },
      { say: "So Jordan just says it. Projects, a start and stop button, today's hours, a weekly total.", shot: 'Voice overlay with the live transcript.' },
      { staged: true, say: "AmberX picks the pieces from its library matrix, shown here as a preview. Storage, sync, a data grid, reminders. All pre-built. No code.", shot: 'Staged library matrix with ticks filling in.' },
      { say: "Approve the plan, and a crew of agents builds it on the real Android template while the train keeps moving.", shot: 'Approve card; the build in the orchestrator queue.' },
      { say: "The look comes from swappable tokens. Pick a skin, save it, reuse it in every app after this.", shot: 'Skin swap atelier to ledger; save look.' },
      { staged: true, say: "At the office, the app is waiting. Install, tap start, done. That part's a preview for now.", shot: 'Staged install and the running timer.' },
      { say: "Talk an app into existence on your way to work. Join the waitlist.", shot: 'End card.' },
    ],
  },
};
