// Deep dive (step s16): one real order through the build orchestrator, end to end, plus a rejected launch.
export default {
  id: 'orchestrator', step: 's16', kind: 'deep', title: 'One order through the build orchestrator',
  app: 'console-web', viewport: 'desktop', skin: 'newsroom',
  hook: 'Follow one real build from order to landed, and watch a sneaky one get turned away.',
  facts: [
    'Build ids (build-id@1): lowercase letters, digits and dashes, at most 40 characters; the same title or id twice is refused.',
    'Pending → Queued → Active; the VPS hard build limit (build-limit@1) is 8 by default: the host refuses the ninth headless build whoever asked, and holds a queued start until a place is free.',
    'Dispatch gate (deploy/claude-headless.sh, framework/cli/dispatch-gate.mjs): a launch that belongs to a build is refused unless it carries the orchestrator dispatcher\'s one-build token, spent when the session starts.',
    'Model gate: a run on a higher model than its step is refused with exit 3.',
    'Builds store: 917 builds, 5,040 steps (Nov 15 2026). The order followed here is this video series itself (demo-video-series-three-minute-browser, PR #667).',
    'Staged: nothing. The rejected launch is a real run of the gate on a made-up build name.',
  ],
  chapters: [
    {
      id: 'order', title: 'The order',
      scenes: [
        { say: "Hi, I'm Amber. Everything here is live. We're going to follow one real order through the build orchestrator: the order for this very video series.", shot: 'Build orchestrator, the Pending tab, real builds listed.' },
        { say: "An order comes in, from voice, Plan Studio or the console. The orchestrator checks it isn't a duplicate, then gives it a build id: short, lowercase, unique. This one is demo video series three minute browser.", shot: 'Open the build: its id, title, source and created time.' },
        { say: "It lands in Pending first. Pending is the waiting room: the plan is set, the steps are written, nothing is running yet.", shot: 'Pending tab with the build card highlighted.' },
      ],
    },
    {
      id: 'steps', title: 'Steps, models and estimates',
      scenes: [
        { say: "Inside, the build is a list of steps. Each one is ten minutes or less of work, with an estimate, and each is pinned to a model: Fable for the hard parts like contracts and engines, Opus everywhere else.", shot: 'The step list: estimates and model chips.' },
        { say: "Notes collect as it goes: which account ran it, what was decided, why a step stopped. Approvals live here too, like a request to raise a step's model.", shot: 'The notes timeline; an approvals entry.' },
      ],
    },
    {
      id: 'flow', title: 'Slots and the queue',
      scenes: [
        { say: "When slots open up, Pending sends builds on to the Queue. The queue only lets a set number run at once. On this server, the limit is eight.", shot: 'Queue tab; the slot count chip showing used out of eight.' },
        { say: "Watch it move. A build finishes, a slot frees, and the next one in line starts by itself. Builds flow through steadily instead of all at once and choking the server.", shot: 'Live: one Active build lands, the counter drops, the next Queued build turns Active.' },
        { say: "And the limit is enforced by the server itself, not just the screen. Ask for a ninth, and the host says no and holds it until there's room.", shot: 'Agent cap settings: live usage and the hard limit.' },
      ],
    },
    {
      id: 'work', title: 'Work, review, land',
      scenes: [
        { say: "Our build is Active. The agent works step by step: commit, push, tick. Each tick reaches the live board at once, so you can watch the steps go green.", shot: 'The build card ticking off steps live.' },
        { say: "Every build has a branch and a pull request. Here's ours, pull request six sixty-seven, with every step as a commit.", shot: 'GitHub PR #667 with its commits.' },
        { say: "When it's done, screens go to UI Review, the checks run, and the merge queue lands it on main. Then the build moves to Landed.", shot: 'UI Review; the merge queue banner; the build in Landed.' },
      ],
    },
    {
      id: 'guard', title: 'No sneaking in',
      scenes: [
        { say: "Now the security part. What if someone tries to start a build by hand, skipping the orchestrator, to slip something in?", shot: 'A terminal, ready.' },
        { say: "Every launch has to carry a one-time token from the orchestrator's dispatcher, tied to one build. It's spent the moment the session starts.", shot: 'Diagram over the dispatcher: order → build id → token → launch.' },
        { say: "So here's a hand-wired launch for a made-up build. Refused. One line saying why, and nothing started. No valid id, no token, no build.", shot: 'Terminal: the launch attempt and the refusal line from the dispatch gate.' },
        { say: "Same for models: try to run a step on a bigger model than it's pinned to, and that's refused too. Every build goes through the orchestrator, every time. Join the waitlist.", shot: 'The model gate refusal; end card.' },
      ],
    },
  ],
};
