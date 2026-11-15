// Step s23 (2 of 4): the old way vs AmberX, side by side. Every number is either sourced or labelled an estimate.
export default {
  id: 'old-way', step: 's23', kind: 'deep', title: 'The old way vs AmberX',
  app: 'console-web', viewport: 'desktop', skin: 'clinic',
  hook: 'Same app, two ways. Weeks and a team, or minutes and your voice.',
  facts: [
    'The traditional-build numbers are estimates and the narration and on-screen captions say so: a small internal app (time tracker with sync, reminders and a weekly report) estimated at 4 to 8 weeks for a developer or two, including design, a back end, an Android client, testing and release. No dollar figure is quoted; viewers can apply their own rate.',
    'AmberX side: the orchestrator\'s own estimate and actual times come from the real build record and shipped manifest (steps with estimated and actual minutes); quote those on the day, not a made-up number.',
    'Real counts: 23 catalog libraries, 6 skins, 54 asset types. Staged: the library matrix and the finished time tracker on the phone.',
  ],
  chapters: [
    {
      id: 'same', title: 'Same app',
      scenes: [
        { say: "Hi, I'm Amber. One app, built two ways, side by side. A time tracker for a small team: projects, a start and stop button, sync between phone and desktop, a reminder, and a weekly report. Every number on the left is an estimate, and it says so on screen.", shot: 'Split screen: Old way on the left, AmberX on the right; an Estimate tag on the left side.' },
      ],
    },
    {
      id: 'week1', title: 'Getting started',
      scenes: [
        { say: "The old way starts with meetings. Requirements, a design, a choice of stack. Then someone sets up a project, a database, logins and a server. That's commonly a week or more before the first real screen. Estimate.", shot: 'Left: a calendar filling with meetings; a whiteboard architecture; Estimate tag.' },
        { say: "On the right, you say it. Plan Studio writes the plan, checks what the framework already has, and gives you a feature matrix with minutes per step.", shot: 'Right: voice; Plan Studio plan; the feature matrix.' },
      ],
    },
    {
      id: 'build', title: 'Building',
      scenes: [
        { say: "The old way writes the parts by hand: storage, sync, logins, notifications, settings, a data table, a look. Each one built, tested and fixed. Two to six more weeks for a small team, depending on who you ask. Estimate.", shot: 'Left: a code editor scrolling; a task board with dozens of cards; Estimate tag.' },
        { staged: true, say: "On the right, those parts already exist as libraries, twenty-three in the catalog today, and the library matrix, shown here as a preview, ticks the ones this app needs. Nothing gets written twice.", shot: 'Right, staged: the library matrix with ticks.' },
        { say: "And when something changes halfway through, which it always does, you say it, and the plan and the remaining steps change with it. No change request, no re-estimate meeting.", shot: 'Right: a spoken change; the plan and remaining steps update.' },
        { say: "A crew of agents assembles it in short, checked steps. You watch it happen, and you approve what matters.", shot: 'Right: Crew live; an approval.' },
      ],
    },
    {
      id: 'look', title: 'Looking right',
      scenes: [
        { say: "The old way often ends up with a look that's hard to change: colours and sizes scattered through the code. A redesign means touching hundreds of files.", shot: 'Left: a search showing hard-coded colours across many files.' },
        { say: "On the right, everything comes from tokens. Change the skin, and the whole app changes, along with every other app you have.", shot: 'Right: skin swap.' },
      ],
    },
    {
      id: 'result', title: 'The result',
      scenes: [
        { say: "Here are the real AmberX numbers for this build, straight from its record: the estimate the orchestrator gave before it started, and the actual time each step took.", shot: 'Right: the shipped manifest with estimated vs actual minutes per step.' },
        { staged: true, say: "And the app on the phone, a preview, running the same day it was asked for.", shot: 'Right, staged: the time tracker running.' },
        { say: "Left: weeks, a team, and a lot of code, by our estimate. Right: one person, a conversation, and an afternoon. Your mileage will vary. That's the point of putting both side by side. Join the waitlist.", shot: 'Both sides with their totals; the Estimate tag on the left; end card.' },
      ],
    },
  ],
  short: {
    title: 'The old way vs AmberX (60 seconds)',
    scenes: [
      { say: "Same app, two ways: a team time tracker with sync, reminders and a weekly report. The old-way numbers are our estimates, and they say so on screen.", shot: 'Split screen with the Estimate tag on the left.' },
      { say: "The old way: meetings, a stack, a server, then every part written by hand. Weeks of work for a small team, by our estimate.", shot: 'Left: meetings, code, a task board.' },
      { staged: true, say: "AmberX: say it, and the plan picks from twenty-three ready libraries in the library matrix, a preview here. A crew of agents assembles it.", shot: 'Right: voice; staged matrix; Crew.' },
      { say: "Change your mind halfway? Say it, and the remaining steps update. No change request, no new meeting.", shot: 'Right: a spoken change; the plan updates.' },
      { say: "The look is tokens, so one click changes it everywhere. And the real estimate and actual times come straight from the build record. Join the waitlist.", shot: 'Right: skin swap; the shipped manifest times; end card.' },
    ],
  },
};
