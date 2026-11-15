// Deep dive (step s17): the console on a phone. Agent chat by voice, the agent picker, and several sessions at once.
export default {
  id: 'console-phone', step: 's17', kind: 'deep', title: 'The console in your pocket',
  app: 'console-web', viewport: 'phone', skin: 'control-room',
  hook: 'No laptop, no terminal. Talk to the agent and it builds.',
  facts: [
    'The Dev Console (apps/console-web) runs on a phone browser and inside AmberX; the AI assistant (assistant@1) is its chat window, with live sessions, write-mode approval cards and the Claude Code MCP bridge. Agent voice gives each agent a voice and a mic with a live status light.',
    'Agent picker (agent-pick@1, claude-session plugin): every Claude session works as a crew agent; with "Ask me every session" on, the console pops the picker (avatar, status, current job, today\'s cost, hours, rating) and axHub holds one approval as a fallback, pushed to the phone.',
    'Each headless build runs as its own Claude Code session in its own git worktree under axf-builds.slice with CPU and memory caps (deploy/claude-headless.sh); Claude accounts route jobs across logins (claude-accounts).',
    'Permissions per agent come from the agent definition (agent-definition@1): tools, write mode and which approvals it may ask for.',
    'Staged: one Docker container per agent session. Today sessions are separated by worktree, branch and slice, not by container.',
  ],
  chapters: [
    {
      id: 'chat', title: 'Just talk',
      scenes: [
        { say: "Hi, I'm Amber. This is the console on a phone. No laptop, no terminal, no typing commands. Most of what you'll see is live; one part, separate containers per agent, is a preview.", shot: 'Phone: the console Home; the Preview legend fades in.' },
        { say: "Open the assistant. It's a chat window, with a mic. Tap and talk, the same way Brett runs everything from his phone.", shot: 'The assistant window full screen on the phone; the mic button and the voice status light.' },
        { say: "Add a dark mode switch to the notes page settings. The agent answers out loud, writes up a plan, and asks before it touches anything.", shot: 'Spoken request; the transcript; the agent\'s spoken reply and plan card.' },
        { say: "An approval card pops up: write mode on the console project. Approve. It starts working, and the chat shows each step as it goes.", shot: 'Write-mode approval card; tap Approve; progress lines stream in.' },
      ],
    },
    {
      id: 'picker', title: 'Pick your agent',
      scenes: [
        { say: "Every session is a crew member. When a new one starts, the agent picker pops up: every agent, with its avatar, what it's doing now, today's cost, its hours and its rating.", shot: 'The agent picker sheet on the phone.' },
        { say: "Tap one for the full card: history, the session browser, the terminal, and the group chat it talks in.", shot: 'Tap an agent row; the detail view with links.' },
        { say: "Each agent comes with its own permissions. The front desk can route work but can't write code. A builder can write in its own branch, but can't approve its own deploy. Owner-only calls always come back to you.", shot: 'Two agent cards compared: tools, write mode, approvals allowed.' },
      ],
    },
    {
      id: 'parallel', title: 'Many at once',
      scenes: [
        { say: "Now start three jobs at once. A settings fix, a new chart, and a docs update. Each one is its own Claude Code session with its own config.", shot: 'Three requests sent from the phone; three session cards appear.' },
        { say: "They never step on each other. Each session works in its own copy of the code, on its own branch, with its own share of the server's memory and CPU.", shot: 'Session browser: three sessions, three worktrees, three branches.' },
        { staged: true, say: "Next, each agent gets its own container too, so even their tools and packages are separate. That part is a preview.", shot: 'Staged diagram labelled Preview: three agents, three containers, one hub.' },
        { say: "And from the phone, you see all of them live: what each is doing, which step, how long, how much it's cost so far.", shot: 'The live status list on the phone: three sessions with step, time and cost.' },
      ],
    },
    {
      id: 'done', title: 'Done from the couch',
      scenes: [
        { say: "Need to check on one? Open its session and read along: every file it touched, every message it sent to the group chat, every approval it asked for. You don't have to wait for it to finish to know where it's going.", shot: 'Open one session from the live list; its file list, chat lines and approvals.' },
        { staged: true, say: "If one goes the wrong way, stop it from the phone. The branch stays, nothing lands. Handing the job to a different agent with one tap is a preview.", shot: 'Stop on one session; the reassign sheet with the agent list.' },
        { say: "The first one finishes. A notification: ready for review. Tap it, look at the phone and desktop shots, approve. The merge queue does the rest.", shot: 'Notification; UI Review item on the phone; Approve.' },
        { say: "The console, in your pocket. Talk, pick an agent, approve, and keep living your life. Join the waitlist.", shot: 'End card.' },
      ],
    },
  ],
};
