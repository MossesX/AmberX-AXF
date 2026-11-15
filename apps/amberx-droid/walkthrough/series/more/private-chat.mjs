// Hero video 4 (step s9): a private messaging server for a team, on their own VPS.
export default {
  id: 'private-chat', step: 's9', kind: 'hero', title: 'Your own private chat server, by lunch',
  app: 'amberx-droid', viewport: 'phone', skin: 'windows',
  hook: 'Your team, your server, your data. Built by talking.',
  facts: [
    'The accounts module (shipped inside apps/expenses) has sign-in, a members list and a messenger: a thread list, live delivery over a server stream, unread counts and a members picker that starts a direct message.',
    'Deploys to your own server run through the framework deploy kit (framework/deploy) and Coolify on the VPS.',
    'axHub approvals with a countdown and the crew (Patches, Polo, Brownie, Ashes, Landin\' Lenny) are real; the Breakroom chat lines here are scripted, so they are staged.',
    'Staged: channels, file sharing, the Android chat client, voice-to-app assembly, the library matrix.',
  ],
  chapters: [
    {
      id: 'need', title: 'Not one more cloud',
      scenes: [
        { camera: 'story', say: "Nadia runs a twelve-person engineering firm. The client contracts say project files can't sit on someone else's cloud. And right now, half the team is sharing drawings over a free chat app.", shot: 'Small office, people at drafting screens; a phone showing a consumer chat app.' },
        { camera: 'story', say: "Nadia needs a private chat server, just for the firm, and needs it this week. So Nadia opens AmberX.", shot: 'Nadia at a desk, coffee, opening AmberX on the phone.' },
        { say: "Hi, I'm Amber. Screens marked Preview are still being finished. Logins, direct messages, approvals and the deploy pipeline are real today.", shot: 'AmberX Home; the Preview legend fades in.' },
      ],
    },
    {
      id: 'describe', title: 'Say it',
      scenes: [
        { say: "A private chat server for my company, with logins, channels, direct messages and file sharing. Only our people can get in.", shot: 'Voice overlay LISTENING; the transcript fills in.' },
        { say: "Plan Studio writes it up: accounts with an invite-only sign-up, channels, direct messages, file uploads, and a web client plus the Android app. It also asks where to host it. Nadia says: on our own server.", shot: 'Plan Studio plan card: features, then a Host on: own VPS choice.', app: 'console-web' },
        { staged: true, say: "In the library matrix, a preview here, each feature lines up with pre-built AXF libraries. Accounts, the messenger, the document store for files, hub storage and sync, notifications. Front end and back end, already written.", shot: 'Staged library matrix: rows Logins, Channels, DMs, Files, Push; ticks fill in.' },
      ],
    },
    {
      id: 'build', title: 'The crew builds it',
      scenes: [
        { say: "An approval pops up: start this build. Another: deploy to the company VPS. Each has a countdown and a deny button. Nadia approves both.", shot: 'Two axHub approval cards; tap Approve.' },
        { say: "Patches puts it on the floor, Polo starts building, and you can watch every file land in Crew.", shot: 'Crew live with the build running; files ticking by.', app: 'console-web' },
        { staged: true, say: "Over in the Breakroom chat, a preview: Ashes: invite-only means invite-only, no open sign-up page. Polo: locked down, only addresses on the company domain. Brownie: tried to sneak in from outside. Couldn't. Good.", shot: 'Staged Breakroom chat with the three messages and a shield reaction.', app: 'console-web' },
      ],
    },
    {
      id: 'deploy', title: 'On your own server',
      scenes: [
        { say: "When review is green, Landin' Lenny lands it through the merge queue, and the deploy pipeline ships it to Nadia's own VPS. Not ours. Theirs.", shot: 'Orchestrator: the build Landed; the deploy log on the VPS.', app: 'console-web' },
        { say: "The messages, the files, the accounts, all of it lives on that server. Nothing goes to a third-party cloud. If a client asks where the data is, Nadia can point at the box.", shot: 'Diagram: the VPS with the database and the file store inside it, a lock icon on the boundary.' },
      ],
    },
    {
      id: 'team', title: 'The team moves in',
      scenes: [
        { say: "Team members get an invite, sign in, and land on their messages. The sign-in and the direct messages are the real accounts module.", shot: 'Login card; then the messenger with the thread list on the left.', app: 'expenses' },
        { say: "Pick a colleague from the members list and you're in a direct conversation. Messages arrive live, unread counts clear the moment you open the thread.", shot: 'Members picker; open a thread; a message arrives live.', app: 'expenses' },
        { staged: true, say: "Channels for each project, and a drawing dropped straight into the chat. Channels and file sharing are a preview.", shot: 'Staged: a #bridge-retrofit channel; a PDF drawing uploaded with a thumbnail.' },
        { staged: true, say: "On the road, the site engineer gets the same chat in the Android app, with a push the moment the drawing lands. That app is a preview too.", shot: 'Staged: Android chat client with the drawing and a notification.' },
        { say: "Your own chat server. Your people, your server, your data. Join the waitlist and tell AmberX what your team needs.", shot: 'End card: the pitch and the waitlist link.' },
      ],
    },
  ],
  short: {
    title: 'Your own private chat server (60 seconds)',
    scenes: [
      { camera: 'story', say: "Nadia's firm can't keep client files on someone else's cloud. They need their own chat server. This week.", shot: 'Office, a phone with a consumer chat app.' },
      { say: "So Nadia says it: a private chat server with logins, channels, direct messages and file sharing. Only our people can get in.", shot: 'Voice overlay and transcript.' },
      { staged: true, say: "AmberX matches every feature to pre-built libraries, shown here as a preview, and a crew of agents assembles it. Approve, approve.", shot: 'Staged matrix ticks; two approval cards.' },
      { say: "When review is green, it lands through the merge queue and deploys to the company's own VPS. Messages, files and accounts all stay on that one server, so the data never leaves the building.", shot: 'Deploy log on the VPS.', app: 'console-web' },
      { staged: true, say: "The team gets an invite, signs in, and starts talking in direct messages on desktop, and on the Android app, which is still a preview.", shot: 'Messenger on desktop; staged Android chat client.' },
      { say: "Your people, your server, your data. Join the waitlist.", shot: 'End card.' },
    ],
  },
};
