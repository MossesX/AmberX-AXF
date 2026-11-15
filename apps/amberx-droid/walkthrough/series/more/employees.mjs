// Deep dive (step s13): the crew (the cat-named employees) and training one into an expert from the console.
export default {
  id: 'employees', step: 's13', kind: 'deep', title: 'Meet the crew, and train your own expert',
  app: 'console-web', viewport: 'desktop', skin: 'newsroom',
  hook: 'A crew of AI employees, and a way to make any of them an expert in an afternoon.',
  facts: [
    'Crew roles (naming notes, crew-live, agent-swarm and the event tables in the plugins): Marco is VP (spend, sign-off, daily rundown); Patches is the build orchestrator; Polo builds (all-rounder); Brownie is QA; Ashes is security; Jennifer runs the Breakroom; Conrad is the librarian (notes, docs, memory); Chachi is the front desk (greets sessions, runs the agent picker; she/her); Landin\' Lenny lands code through the merge queue; Ping Paulie runs the systems check; Janitor Joey cleans up the pipeline; Snap Sully runs backups; Earl the Ear watches notification rules; Vinnie is axHub\'s approval bot; Gizmo is the AmberX companion.',
    'Owner-only calls (passes, irreversible deletes, model upgrades) are never approved by the crew.',
    'Agent manager (apps/console-web/plugins/agent-manager): agents from personas, lingo, skills and tools, each with persistent memory; wizards for agents, skills, tools and training; training sources are Firecrawl, web pages, the repo and MCP. The AI expert add-on retrains weekly with Firecrawl.',
    'Training here means building a knowledge set into the agent\'s memory from crawled sources, not changing model weights. The narration says "trained on it" in that sense.',
    'Recording needs a Firecrawl key (Settings → Plugins → Agent manager). The before and after answers are recorded live on the day; nothing is scripted for them.',
  ],
  chapters: [
    {
      id: 'roster', title: 'The roster',
      scenes: [
        { say: "Hi, I'm Amber. Everything you're about to see is real and running. AmberX has a crew of AI employees, and yes, they're named after cats.", shot: 'Crew view: every agent card with its avatar, name and role.' },
        { say: "Marco is the VP. He watches spend against the caps, signs off on what ships, and gives the owner a daily rundown. Patches runs the build floor: orders, steps, who works on what.", shot: 'Highlight Marco\'s card, then Patches\'s card.' },
        { say: "Polo builds. Brownie checks every build works before it reaches review. Ashes is security: keys, logins, secrets and approvals. Jennifer runs the Breakroom and keeps morale up.", shot: 'Highlight Polo, Brownie, Ashes, Jennifer.' },
        { say: "Conrad is the librarian who keeps notes and docs tidy. Chachi is the front desk: she greets each new session and runs the agent picker.", shot: 'Highlight Conrad and Chachi.' },
        { say: "And the specialists. Landin' Lenny lands code through the merge queue. Ping Paulie watches system health. Janitor Joey cleans up the pipeline. Snap Sully runs backups. Earl the Ear watches notification rules. Vinnie handles axHub approvals.", shot: 'Highlight each specialist card in turn.' },
      ],
    },
    {
      id: 'handoffs', title: 'How work moves',
      scenes: [
        { say: "Here's one build moving through them. Patches splits it into jobs. Polo takes a job and leases the files, so nobody else edits them at the same time.", shot: 'Agent swarm: the job planner for a live build; file leases shown.' },
        { say: "Brownie picks it up for QA. Lenny takes it through the merge queue. Marco gives the go-ahead. And anything only the owner can decide waits for the owner. The crew never approves those.", shot: 'The same build: QA tick, merge queue, sign-off, and an owner-only item still waiting.' },
        { say: "They talk it over in the Breakroom group chat as they go, so you can scroll back and see who did what, and why.", shot: 'Breakroom group chat with real messages from today.' },
      ],
    },
    {
      id: 'train', title: 'Train an expert',
      scenes: [
        { say: "Now the useful part: making one of them an expert on your thing. Open the agent manager and pick an agent. We'll use a fresh one called Docs Dana.", shot: 'Agent manager: the agent list; open Docs Dana.' },
        { say: "First, ask a question it can't know yet. What changed in the latest release of our framework's sync protocol? Watch the answer. It's honest: it doesn't know.", shot: 'Agent chat: the question and the live, unsure answer.' },
        { say: "Now open Train. Point the built-in crawler at a site, a set of docs, the repository, or an MCP data source. Here, the framework docs folder and the public docs site.", shot: 'Training wizard: choose sources; the repo path and a docs URL entered.' },
        { say: "Start the job. The crawler walks every page, and builds a data set out of it, each page saved with the address it came from.", shot: 'Training job running: pages crawled, the data set growing.' },
        { say: "When it's done, the data set sits in the agent's memory, ready to draw on. That's what trained means here: it knows your material.", shot: 'Training job complete; the data set listed in the agent\'s memory.' },
      ],
    },
    {
      id: 'after', title: 'Before and after',
      scenes: [
        { say: "Same question as before. This time the answer is specific, and it comes from your own docs. Before, a shrug. After, an expert.", shot: 'Agent chat: the same question, the new answer with citations; the before answer beside it.' },
        { say: "Now you can hand it real jobs. In the Breakroom, assign it the job of answering every docs question in the team chat, or reviewing every pull request that touches sync.", shot: 'Breakroom → Jobs: assign a job to Docs Dana.' },
        { say: "A crew that works around the clock, and an expert on anything you point it at. Join the waitlist and meet them.", shot: 'Crew view; end card with the waitlist link.' },
      ],
    },
  ],
};
