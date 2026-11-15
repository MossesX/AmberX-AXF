// Step s18 (3 of 4): the veto and approval system.
export default {
  id: 'veto-approvals', step: 's18', kind: 'deep', title: 'Approvals and the veto',
  app: 'console-web', viewport: 'desktop', skin: 'windows',
  hook: 'Agents do the work. You keep the last word, with a countdown and a Deny button.',
  facts: [
    'veto@1 (framework/libs/hub/veto.ts): a held call runs itself when its countdown ends unless denied; Approve now, Deny, and Shelve (pauses the countdown until Approve now or Deny). Default countdown 90 seconds. Pushed to the phone as held, warning and running phases.',
    'Approvals feed: one list of approvals and held calls on axHub, in the console approvals banner and the AmberX app; every call that changes something carries a reason (title, description).',
    'Owner-only calls (passes, irreversible deletes, model upgrades) are never approved by an agent.',
    'Permissions per agent come from the agent definition (tools, write mode, approvals it may ask for); the agent picker shows them.',
    'No staged scenes.',
  ],
  chapters: [
    {
      id: 'why', title: 'Why two kinds',
      scenes: [
        { say: "Hi, I'm Amber, and all of this is live. Agents in AmberX can do real things: deploy, restart, change settings. So there are two ways you stay in charge: approvals, and the veto.", shot: 'Console with the approvals banner showing one approval and one held call.' },
        { say: "An approval waits for you. Nothing happens until you say yes. A held call is the opposite: it's safe enough to run by itself, so it counts down and runs, unless you veto it.", shot: 'The two cards side by side: Waiting for you vs Runs in 1:30.' },
      ],
    },
    {
      id: 'held', title: 'A held call',
      scenes: [
        { say: "Here's a held call: restart the demo app. It came with a reason: the agent changed its settings and needs a restart to load them. Every call that changes something must say why.", shot: 'The held card expanded: title, reason, who asked, the command.' },
        { say: "Ninety seconds by default. The same countdown shows on the console and on the phone, in sync.", shot: 'Phone and console side by side, both counting down.' },
        { say: "Three buttons. Approve now skips the wait. Deny stops it for good. Shelve pauses the clock when you need a minute to think. Let this one run.", shot: 'Highlight Approve now, Deny, Shelve; the countdown reaches zero; Running, then Done.' },
        { say: "And the veto. A second one: delete old preview builds. Not today. Deny. It's gone, and the agent gets told why.", shot: 'A second held call; Deny on the phone; it clears on both screens.' },
      ],
    },
    {
      id: 'approvals', title: 'Approval pop-ups',
      scenes: [
        { say: "Approvals pop up wherever you are. On the phone, as a notification you can act on. In the console, in the title bar badge. In axHub, in its approvals list.", shot: 'A notification on the phone; the console badge; axHub Approvals.' },
        { say: "Each card can open up for the details: the exact command, the reason, which session asked, and a link straight to it.", shot: 'An approval card expanded to its details and links.' },
        { say: "Approve on any one of them, and the others clear. One decision, recorded once, with who made it and when.", shot: 'Approve on the phone; the console badge drops; the decision in the log.' },
      ],
    },
    {
      id: 'agents', title: 'Permissions per agent',
      scenes: [
        { say: "Each agent has its own permissions. The front desk routes work and can't write code. A builder writes in its own branch. Security can flag anything but deploy nothing.", shot: 'Agent cards compared: tools, write mode, approvals allowed.' },
        { say: "Some calls belong to the owner only: model upgrades, irreversible deletes, passes. No agent can approve those, not even the VP. They always come back to you.", shot: 'An owner-only approval with the lock badge; an agent\'s attempt shown as refused.' },
        { say: "Every decision lands in one history: what was asked, the reason, who decided, approve or deny, and when. Scroll back a month and the whole story is there.", shot: 'The approvals history list, filtered to last month.' },
        { say: "And if you're away from everything, nothing piles up dangerously. Approvals simply wait. Held calls only run if they were safe enough to hold in the first place, and the phone warns you before each one runs.", shot: 'Phone lock screen: a warning push before a held call runs.' },
        { say: "Agents do the work. You keep the last word. Join the waitlist.", shot: 'End card.' },
      ],
    },
  ],
};
