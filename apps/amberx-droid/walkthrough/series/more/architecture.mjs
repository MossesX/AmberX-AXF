// Deep dive (step s14): how it all connects through axHub.
export default {
  id: 'architecture', step: 's14', kind: 'deep', title: 'How it all connects',
  app: 'console-web', viewport: 'desktop', skin: 'windows',
  hook: 'Every piece, what it does, and the one hub they all talk through.',
  facts: [
    'Hosting: a Hostinger VPS running Coolify, with Traefik in front; the console, axHub and apps run as containers (framework/deploy, container-access protected list: Coolify, Traefik, the console, databases).',
    'control@1 (framework/spec/CONTROL.md): one command for every token, entity and the planner, over REST /api/control, MCP control_* tools on the console /mcp and through axHub, and the CLI axf control.',
    'console-control@1 (framework/spec/CONSOLE-CONTROL.md): one address and ten verbs for everything the console shows; console-command@1 carries console commands (PORTING.md).',
    'veto@1: one list of approvals and held calls that count down unless vetoed (libs/hub/veto).',
    'AXPP, the typed protocol between an AXF app and axHub, is a named placeholder parked for a later design pass, so its scene is staged.',
    'Console shell: the Terminal plugin opens Claude Code or a shell on any connection (console container, VPS root, any container, axHub) through tmux; container access goes only through a locked-down Docker socket proxy with an audit log.',
  ],
  chapters: [
    {
      id: 'map', title: 'The map',
      scenes: [
        { say: "Hi, I'm Amber. This is the whole system on one screen, and everything on it is running, except one protocol I'll mark as a preview. In the middle: axHub. Everything else talks through it.", shot: 'An architecture map drawn over real screenshots: axHub at the centre; the Dev Console, AmberX on Android, GitHub, the VPS, Coolify and Claude around it.' },
      ],
    },
    {
      id: 'pieces', title: 'Piece by piece',
      scenes: [
        { say: "The VPS is a rented server at Hostinger. It's needed because your data and your agents should live on a machine you control. Everything below runs on it.", shot: 'The Hostinger panel for the VPS; uptime and resources.' },
        { say: "Coolify runs the containers on that server and deploys new versions. Traefik sits at the front and routes each web address to the right container.", shot: 'Coolify dashboard: the projects and their containers, live.' },
        { say: "axHub is the one true source: settings, data, assets and approvals for every app and device. It's also the doorway: tools from Claude, the console and the phone all go through it, so one place decides who's allowed to do what.", shot: 'axHub web: Hub status, Apps and Approvals.', app: 'axhub-web' },
        { say: "The Dev Console is where builds happen: the orchestrator, the crew, review, the terminal. It runs its own MCP server, so Claude can call console tools directly.", shot: 'Dev Console Home; the MCP tools list.' },
        { say: "GitHub holds the code. Every build gets a branch and a pull request, and the merge queue lands them on main. The console talks to GitHub through its own app with short-lived tokens.", shot: 'GitHub PR list; the merge queue banner in the console.' },
        { say: "AmberX on Android is the remote control and the ears: voice, approvals and notifications, in your pocket.", shot: 'AmberX Home on a phone with a held approval.', app: 'amberx-droid' },
        { say: "And the Claude connectors let a claude.ai chat or voice session reach the console and axHub as tools, so you can run things from a conversation.", shot: 'A claude.ai session calling a console tool; the call showing up in the console session feed.' },
      ],
    },
    {
      id: 'protocols', title: 'The languages they speak',
      scenes: [
        { say: "Tools travel over MCP. A real call now: Claude asks the console for the build list. The request goes through axHub, the console answers, and the call is logged with who made it.", shot: 'A live MCP tool call: request, response, and its line in the audit log.' },
        { say: "control at one is one command for every token, note, task and plan item. Same command whether it comes from REST, MCP, the CLI or your voice. Here I change a token from the command line and the console updates.", shot: 'Terminal: axf control token set; the console repaints live.' },
        { say: "console control at one gives every tab, screen and setting an address and ten verbs. Show, open, scroll, set. That's how an agent or a voice command can drive the console without touching the mouse.", shot: 'console_show on a settings screen; the console navigates there.' },
        { staged: true, say: "AXPP will be the typed line between the phone and axHub: calls, jobs and events. It's designed but not built yet, so this part is a preview.", shot: 'Staged diagram, labelled Preview: phone ⇄ axHub with typed calls, jobs and events.' },
      ],
    },
    {
      id: 'safety', title: 'Approvals and the veto',
      scenes: [
        { say: "Anything that changes something carries a reason, and anything risky is held. A held call counts down on the phone and in the console, and runs unless someone vetoes it. Owner-only calls never run without the owner.", shot: 'A held call with its countdown on the phone and in the console approvals banner side by side.' },
      ],
    },
    {
      id: 'shell', title: 'A shell anywhere',
      scenes: [
        { say: "Last piece: the console shell. Open the Terminal, pick a connection, the console container, the server itself, any container, or axHub, and you're in, inside tmux, so it survives a closed tab.", shot: 'Console Terminal: the connection picker; open a shell into a container.' },
        { say: "Container access goes through one locked-down proxy, with protected containers it won't touch and an audit log of every change. Every piece, connected through one hub. Join the waitlist.", shot: 'Container access settings: the protected list and the audit log; end card.' },
      ],
    },
  ],
};
