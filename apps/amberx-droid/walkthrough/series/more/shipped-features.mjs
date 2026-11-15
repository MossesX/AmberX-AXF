// Step s22: the Shipped Features page, and the orchestrator checking new orders against it.
export default {
  id: 'shipped-features', step: 's22', kind: 'deep', title: 'Shipped Features, and never building it twice',
  app: 'console-web', viewport: 'desktop', skin: 'ledger',
  hook: 'Every feature ever shipped, in one list, and an orchestrator that reads it before building anything new.',
  facts: [
    'Shipped Features (shipped-features plugin, feature-ledger@1): every feature of AmberX-AXF and axHub in one sortable three-level grid (group, feature, details) with status Planned, Queued, Building, In PR, Merged, Live, Cancelled, Removed; the builds, PRs and commits behind it, Brett\'s verbatim prompt, model and agent, and every later edit as a timeline; View by PR, build, day, app, plugin, type or repo; quick filters; CSV and Markdown export; deep link ?shipped=<id>; API, MCP, CLI and voice.',
    'Shipped manifest (shipped-manifest@1, framework/cli/shipped.mjs): when a build lands, the orchestrator gathers the prompt, brief, models, accounts, steps with estimated and actual times, branch, PR, landed commit, files, tests, UI Review, cost and what is open.',
    'Real today: the orchestrator refuses a duplicate build title or id.',
    'Staged: checking a new order against Shipped Features for an existing feature, and checking a new build against shipped features for conflicts, each with its banner.',
  ],
  chapters: [
    {
      id: 'tour', title: 'Everything ever shipped',
      scenes: [
        { say: "Hi, I'm Amber. The Shipped Features page is live, and so is everything it shows. The two checks at the end are a preview, and I'll say when we get there.", shot: 'Shipped Features page in the console; the Preview legend fades in.' },
        { say: "This is every single feature of AmberX and axHub, from the moment a build planned it to the day it went live. Planned, queued, building, in a pull request, merged, live.", shot: 'The grid with the status column; scroll through.' },
        { say: "Open one. Here's the toolbars library. The exact words that asked for it. The build, the pull request, the commits. Which model and which agent did the work.", shot: 'Expand the toolbars entry: prompt, build, PR, commits, model, agent.' },
        { say: "And its timeline. Every edit since, as its own line, so you can see how a feature grew after it first shipped.", shot: 'The timeline of later edits on the same entry.' },
        { say: "View it however you think: by pull request, build, day, app, plugin, type or repository. Hide what's done. Show only what's being edited right now.", shot: 'Switch View by: day, then plugin; quick filters on.' },
        { say: "Each landed build carries a full manifest: the brief, every step with its estimate and its real time, the cost, the tests, the review, and what's still open.", shot: 'The shipped manifest panel on one build: steps with estimate vs actual, cost, tests.' },
        { say: "Export it as a spreadsheet or Markdown, or link straight to any feature. And like everything else, it answers to the API, agents, the command line and your voice.", shot: 'Export menu; copy a deep link; a spoken query returning the same entry.' },
      ],
    },
    {
      id: 'dupe', title: 'Already built',
      scenes: [
        { say: "Now the reason this list matters. Orders come in all day, by voice, from plans, from agents. The orchestrator already refuses the exact same build twice.", shot: 'Orchestrator: a duplicate title refused.' },
        { staged: true, say: "Next it goes further, and this is a preview. Before it gives a new order a build id, it reads Shipped Features. Here's an order: add a library that shows a countdown on approvals.", shot: 'Staged: a new order arriving in Pending, a checking spinner.' },
        { staged: true, say: "A banner: this already exists. Held-call countdowns shipped in the veto library, with a link to the feature, its build and its pull request. Use it instead, or say what's different.", shot: 'Staged: the already-shipped banner with links.' },
        { staged: true, say: "No duplicate build, no wasted hours, no second copy of the same code to keep in step.", shot: 'Staged: the order closed as already shipped.' },
      ],
    },
    {
      id: 'conflict', title: 'Nothing breaks',
      scenes: [
        { staged: true, say: "Second check, also a preview. A different order: change how the toolbar confirms taps on phones. That's new, so it gets a build id. But it touches something that's shipped.", shot: 'Staged: the order getting its id; a second check running.' },
        { staged: true, say: "A banner flags it: five apps use the toolbars library. Here they are, and here's what the change would affect in each. The build carries that list, so its tests cover all five.", shot: 'Staged: the conflict banner with the five apps listed.' },
        { say: "One list of everything that's shipped, and an orchestrator that reads it first. Join the waitlist.", shot: 'Shipped Features; end card.' },
      ],
    },
  ],
};
