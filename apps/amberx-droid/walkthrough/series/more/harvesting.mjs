// Step s24: one framework, pre-built libraries, and harvesting new libraries out of any code that gets written.
export default {
  id: 'harvesting', step: 's24', kind: 'deep', title: 'One framework, and code that never gets written twice',
  app: 'console-web', viewport: 'desktop', skin: 'atelier',
  hook: 'Everything fits because it\'s one framework. Everything gets faster because nothing is written twice.',
  facts: [
    'Library count: 23 in framework/catalog/libraries.json (Nov 15 2026). The narration says twenty-three, never "thousands".',
    'Real harvests (framework/libs/README.md and git log): lib-apiclient from nine Dev Console plugins (Oct 2026); dnd, tree, datagrid, workspace, recorder and docstore from Walkthrough Studio in one day (Oct 22 2026, commit "Harvest Walkthrough Studio into six framework libraries with configurable parts"); lib-claude-session from the console Terminal (Nov 3 2026); lib-toolbars from the console Toolbars plugin, now in five apps (Nov 3 2026); the axHub connector from the axHub web app (Oct 20 and 23 2026).',
    'The library-harvest build (PR #378) was started by voice on Nov 7 2026 with the goal "whip up sophisticated apps by voice in five minutes... just assembly".',
    'Library installer (framework/cli/libraries.mjs, Android libraries today): each library declares its wizard parameters (library@1); installing writes the manifest, the dependency, the module registration and a typed config object. No hand-written code.',
    'Staged: AmberX deciding on its own where to split freshly written code and pulling out the library automatically. Harvests so far were done by agents in builds, as above.',
  ],
  chapters: [
    {
      id: 'one', title: 'Why one framework',
      scenes: [
        { say: "Hi, I'm Amber. This is the idea everything else rests on. The harvests you'll see really happened, and they're in the git history. Harvesting on its own, automatically, is a preview.", shot: 'Console; the libraries README; the Preview legend.' },
        { say: "Every AmberX app is built on one framework. Same kernel, same way of storing data, same tokens for the look, same way of talking to axHub.", shot: 'Diagram: several apps on one framework layer, axHub underneath.' },
        { say: "So pieces fit. A data grid from one app drops into another and just works. It looks right, because it uses the same tokens. It saves to the same hub, so the apps can share what they know.", shot: 'The same grid in Walkthrough Studio, the builds page and axHub Approvals.' },
        { say: "Twenty-three libraries ship in the catalog today, front end and back end.", shot: 'The catalog list.' },
      ],
    },
    {
      id: 'harvest', title: 'Harvesting',
      scenes: [
        { say: "But you'll still write code sometimes. Or Claude will. Something new, that no library covers yet. Here's what happens to it.", shot: 'An agent writing a new feature in Crew.' },
        { say: "A real example. The console had nine plugins that each had their own copy of the code for talking to the server. Nine copies, nine ways to drift apart. So it was harvested: one API client library, and all nine use it now.", shot: 'The commit that added the API client; the nine plugins switching to it.' },
        { say: "Another. On October twenty-second, Walkthrough Studio gave up six libraries in one go: drag and drop, the tree, the data grid, the workspace, the screen recorder and the document store.", shot: 'git log: the harvest commit; the six folders appearing.' },
        { say: "The console's toolbars became a library. Today it's in five apps. The Terminal's session code became one too.", shot: 'lib-toolbars in five apps; the claude-session library.' },
        { staged: true, say: "Next, AmberX does this as it goes, and this part is a preview. When new code lands, it looks for the reusable part, decides where to split it, pulls it out as a library with its settings, and saves it to the catalog.", shot: 'Staged: a landed build; a harvest card proposing a split; the new library in the catalog.' },
      ],
    },
    {
      id: 'reuse', title: 'Never twice',
      scenes: [
        { say: "Then it's assembly. Pick a library, answer a few questions in its wizard, and the installer wires it in: the manifest, the dependency, the setup. No code to write.", shot: 'Library install wizard: parameters; the generated setup shown.' },
        { say: "Because the wizard's answers become a small, typed settings file, two apps can use the same library in different ways without either one forking it. Fix a bug in the library, and every app gets the fix.", shot: 'Two apps\' generated setup files side by side; one library version bump reaching both.' },
        { say: "That's why it's fast. No waiting hours, days or weeks to write and stitch code together. Code gets written once, harvested, and from then on it's a part.", shot: 'Timeline: one build writes it; the next three builds just install it.' },
        { say: "And every harvest adds to the libraries that ship with the framework. The more anyone builds, the less anyone has to. Join the waitlist.", shot: 'The catalog count ticking up; end card.' },
      ],
    },
  ],
  short: {
    title: 'Code that never gets written twice (60 seconds)',
    scenes: [
      { say: "Every AmberX app sits on one framework, so every piece fits, looks the same and connects through axHub. Twenty-three libraries ship in the catalog today.", shot: 'Diagram; the catalog.' },
      { say: "When new code does get written, by Claude or by you, the reusable part gets harvested. Nine copies of the server code became one library. Walkthrough Studio gave up six in one day.", shot: 'The harvest commits.' },
      { staged: true, say: "Next, AmberX does it on its own as code lands: it finds where to split, pulls out the library with its settings, and saves it to the catalog. That part is a preview.", shot: 'Staged: a harvest card; the new library.' },
      { say: "Then it's assembly. Pick the library, answer a few questions in its wizard, and the installer wires it in. No code. Nothing written twice, which is what makes it fast. Join the waitlist.", shot: 'The install wizard; end card.' },
    ],
  },
};
