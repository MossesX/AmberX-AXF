// Real demo (step s12): AmberX built with itself. No staging: every screen and number is real. Recount the numbers on
// the day of recording (the commands are in `facts`) and update the narration if they've moved.
export default {
  id: 'built-with-itself', step: 's12', kind: 'real', title: 'Built with itself',
  app: 'console-web', viewport: 'desktop', skin: 'control-room',
  hook: 'Everything you assemble with was battle-tested building AmberX itself.',
  facts: [
    'Counted Nov 15 2026 from the repo: 7,748 commits since the first on Oct 15 2026 (git rev-list --count HEAD).',
    '917 builds in _claude/builds/store.json: 385 complete, 241 built, 226 archived; 5,040 steps; 460 with a PR; 95 started from a voice note (origin.source = voice).',
    'Pull requests up to #677 on GitHub.',
    '68 console plugins (apps/console-web/plugins), 54 asset types (framework/assets), 220 distinct --fx-* design tokens in framework/ui, assets and core.',
    '23 libraries in framework/catalog/libraries.json, 20 web libraries in framework/libs.',
    'Voice-to-build example: library-harvest, started by voice ("whip up sophisticated apps by voice in five minutes... just assembly"), PR #378.',
    'Harvest examples (framework/libs/README.md and git log): lib-apiclient harvested from nine Dev Console plugins (Oct 2026); dnd, tree, datagrid, workspace, recorder and docstore harvested from Walkthrough Studio (Oct 22); lib-claude-session harvested from the console Terminal (Nov 3); lib-toolbars, the console Toolbars plugin, now in five apps (Nov 3). lib-datagrid (from Walkthrough Studio) is used by feature-matrix, builds-page, shipped-features, crew-live, changes-grid and glossary-index in the console and by axHub Approvals.',
  ],
  chapters: [
    {
      id: 'open', title: 'The tool that built the tool',
      scenes: [
        { say: "Hi, I'm Amber. Nothing in this video is staged. Every screen is live, and every number comes straight from the repository. This is the console that builds AmberX, and it was built by AmberX.", shot: 'Dev Console Home, live; the git log scrolling in a terminal pane.' },
        { say: "The first commit landed on October fifteenth. A month later, there are seven thousand seven hundred and forty-eight. Nine hundred and seventeen builds, more than five thousand steps, and pull requests up to number six seventy-seven.", shot: 'Builds page with the totals; GitHub pull request list sorted newest first.' },
      ],
    },
    {
      id: 'voice', title: 'Asked for out loud',
      scenes: [
        { say: "Ninety-five of those builds started as something Brett said out loud. Here's one, word for word, from November seventh: we need to harvest as many libraries as possible, so we can whip up apps by voice in five minutes. No building, just assembly.", shot: 'Orchestrator: open build library-harvest; the origin card with the voice transcript and source Voice.' },
        { say: "The orchestrator turned that into a build with an id, a branch, and pull request three seventy-eight. Steps, models, estimates, notes, all on the record.", shot: 'The same build: branch, PR #378, the step list and notes.' },
        { say: "And this build, the one making this video, is in there too. Here are its steps, ticking off as the scripts are written.", shot: 'Orchestrator: demo-video-series-three-minute-browser with its ticked steps.' },
      ],
    },
    {
      id: 'live', title: 'The console updates itself',
      scenes: [
        { say: "The agents work inside the console. Crew shows each one live: which build, which file, what it's doing right now.", shot: 'Crew live with running builds and files changing.' },
        { say: "When an agent starts on a screen, it tells the console where it is, and the live preview follows it. You watch the console change while it's being changed.", shot: 'Watch live: the preview follows a focus note; the screen hot-renders.' },
        { say: "Screens go to UI Review, the merge queue lands them, and main pulls them in. The console you're looking at was rebuilt that way hundreds of times.", shot: 'UI Review item; the merge queue banner landing a batch; main pulled.' },
      ],
    },
    {
      id: 'harvest', title: 'Harvested as it went',
      scenes: [
        { say: "Here's the part that matters for you. Every web app in AmberX had its own copy of the code for talking to a server. Nine console plugins, nine copies. So it was harvested into one library, the API client, and every app uses that now.", shot: 'framework/libs README: the API client section; the git commit that harvested it.' },
        { say: "Walkthrough Studio gave up six libraries in one day: drag and drop, the tree view, the data grid, the workspace, the screen recorder, and the document store.", shot: 'framework/libs folder; the harvest commit from October twenty-second.' },
        { say: "The console's toolbars became a library too. Today it's in five apps: the console, axHub, the AmberX phone app, Molly and Walkthrough Studio.", shot: 'Search results for lib-toolbars across the five apps.' },
        { say: "Every harvested piece goes into the library catalog. Twenty-three are in it right now, each with its name, what it does, and which apps can use it.", shot: 'framework/catalog/libraries.json rendered in the library browser.' },
        { say: "Dropping one into another app is configuration, not code. The data grid built for Walkthrough Studio now runs the feature matrix, the builds page and Shipped Features in the console, and the approvals list in axHub.", shot: 'Walkthrough Studio grid, then the feature matrix, the builds page and axHub Approvals, each with the same grid.' },
      ],
    },
    {
      id: 'close', title: 'Battle-tested',
      scenes: [
        { say: "Sixty-eight plugins, fifty-four asset types, two hundred and twenty design tokens. Every one of them ran this place before it was offered to you.", shot: 'Plugin Manager list; the asset type list; the token registry.' },
        { say: "Everything you assemble with was battle-tested building AmberX itself. Join the waitlist.", shot: 'End card with the waitlist link.' },
      ],
    },
  ],
};
