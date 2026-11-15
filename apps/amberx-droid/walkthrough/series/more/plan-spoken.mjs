// Step s18 (1 of 4): Plan Studio, from a spoken idea to a plan, steps and builds. Real data.
export default {
  id: 'plan-spoken', step: 's18', kind: 'deep', title: 'From a spoken idea to a build plan',
  app: 'console-web', viewport: 'desktop', skin: 'ledger',
  hook: 'Say an idea while you walk. Come back to a plan with steps, estimates and builds.',
  facts: [
    'Plan Studio (apps/console-web/plugins/plan-studio): plans, the catalog check against what the framework has, AI edits in plain English, Turn into a build. Builds carry origin.said, the words that started them (build-origin@1); 95 builds started from voice (Nov 15 2026).',
    'Real example used: library-harvest, started by voice on Nov 7 2026, PR #378.',
    'The orchestrator refuses a duplicate title or id; the feature matrix shows minutes and models per row.',
    'No staged scenes: the idea is spoken live on the day and the plan it produces is shown as it comes out.',
  ],
  chapters: [
    {
      id: 'say', title: 'Say it',
      scenes: [
        { say: "Hi, I'm Amber. Everything in this one is live. Ideas don't wait for a keyboard, so in AmberX you can plan out loud. Here's a real one, said on a walk, word for word.", shot: 'AmberX on the phone: a voice note being recorded; the transcript scrolling.', app: 'amberx-droid' },
        { say: "The words arrive in Plan Studio exactly as they were said, ums and all, and they stay on the record. Every build that comes out of it keeps the original sentence, so you can always see what was really asked for.", shot: 'Plan Studio: the raw transcript card on a new plan.' },
        { say: "Here's one from November seventh: harvest as many libraries as possible, so we can whip up apps by voice in five minutes. That sentence is still attached to its build today.", shot: 'Builds: library-harvest; the origin card with the voice transcript.' },
      ],
    },
    {
      id: 'shape', title: 'From words to a plan',
      scenes: [
        { say: "Plan Studio turns the rambling into a plan: a title, the goal in one line, the features, and what's out of scope.", shot: 'The structured plan next to the transcript.' },
        { say: "Then it checks the catalog. What does the framework already have? Those features are marked as done or partly done, so nobody builds them twice.", shot: 'The catalog check: features tagged Have, Partial, New.' },
        { say: "Change it by talking to it. Drop the export idea. Make the sync part its own phase. Each edit shows up as a change you can keep or undo.", shot: 'AI edits in plain English; the diff on the plan; keep one, undo one.' },
      ],
    },
    {
      id: 'steps', title: 'Steps and estimates',
      scenes: [
        { say: "Next, the steps. Each one ten minutes of work or less, with an estimate, and a model: Fable where the work is a contract or an engine, Opus for the rest.", shot: 'The step list with minutes and model chips.' },
        { say: "The feature matrix adds it up. Untick a row and the total time and cost drop before anything has run.", shot: 'Feature matrix: untick a row; totals change.' },
        { say: "Big ideas split into phases, and phases can become separate builds, so a small first version can land while the rest waits.", shot: 'The plan split into two phases; one marked Build now.' },
      ],
    },
    {
      id: 'build', title: 'Turn it into builds',
      scenes: [
        { say: "Before it becomes a build, read it once more. Every step says what it touches, so you can spot the one that would change something you care about, and say leave the login screen alone. The plan updates, and the estimate with it.", shot: 'Step details expanded; a spoken edit; the step removed and the total updated.' },
        { say: "Turn into a build. The orchestrator checks it isn't a duplicate, gives it an id, and puts it in Pending. The plan and the build stay linked.", shot: 'Turn into a build; the new build in Pending with a link back to the plan.' },
        { say: "As agents finish steps, the plan ticks along with them. Open the plan a week later and you see exactly how far it got, and what's left.", shot: 'The plan with ticked steps and the remaining ones.' },
        { say: "And plans stay searchable. Type libraries into the search, and Plan Studio finds the plan, then one click takes you to its build and the original words.", shot: 'Plan Studio search: libraries; the plan; its build and its transcript.' },
        { say: "Say it on a walk, come back to a plan, ship it in builds. Join the waitlist.", shot: 'End card.' },
      ],
    },
  ],
};
