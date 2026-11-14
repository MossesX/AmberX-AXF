// Demo video series: three-minute browser walkthroughs of AmberX (build demo-video-series-three-minute-browser).
//
// Seven short videos, each one topic, each recorded as a real browser walkthrough on live data. Same shape as the
// 2-hour walkthrough (walkthrough-video@1: chapters → scenes), so its recorder, Piper narration, assembler and player
// are reused. Here each scene carries:
//   say     Amber's narration (TTS + captions). About 150 spoken words a minute; check.mjs keeps every video near 3:00.
//   shot    what the camera shows, in plain words. Step s3 turns each shot into an `act` with the recorder helpers
//           (nav, hl, click, type, scroll, calm, settings, menu).
//   app     where the shot is recorded (console-web, axhub-web, amberx-droid, axhub-android); defaults to the video's app.
//   staged  true when the screen is not built yet and is shown as a mock (step s2). Staged scenes get a visible
//           "Preview" label in the recording; the narration says so too. Never present a staged screen as shipped.
// Each video names a skin (framework/assets/skin) so the themable player switches look between videos.
// Facts must match the product; anything not built is staged or left out, not promised.

export const SERIES = {
  $axf: 'walkthrough-series@1',
  id: 'amberx-three-minute',
  title: 'AmberX in three minutes',
  voice: 'en_US-kristin-medium',
  wordsPerMinute: 150,
  targetSeconds: 180,
  viewport: { desktop: { width: 1440, height: 900 }, phone: { width: 412, height: 915 } },
};

export const VIDEOS = [
  // ───────────────────────────────────────────────────────────── 1. Voice control
  {
    id: 'voice-control', order: 1, title: 'Talk to it: voice control in AmberX', app: 'amberx-droid', viewport: 'phone', skin: 'control-room',
    hook: 'Run your whole build pipeline without touching the screen.',
    chapters: [
      {
        id: 'intro', title: 'Say the word',
        scenes: [
          { say: "Hey, I'm Amber. In the next three minutes I'll show you how you run AmberX with your voice. No menus, no typing. You talk, it does the thing.", shot: 'AmberX Home on a phone, the banner and the bottom nav in view.' },
          { say: "First, the wake word. AmberX listens quietly in the background with an offline model. It only knows a handful of phrases, so nothing else you say is transcribed, and there's no beep every few seconds.", shot: 'Voice page, the Hands-free card; highlight the IDLE · WAKE chip on the overlay.' },
          { say: "Say Amber X, and it switches to full listening for one sentence. The chip flips to Listening and your words show up live as you speak.", shot: 'Overlay chip changes to LISTENING; the live transcript line fills in.' },
          { say: "You set how eager it is. Low only wakes on a clear, full phrase. Normal reacts as you speak. High catches you even when you mumble from across the room.", shot: 'Voice settings: the wake sensitivity choice Low / Normal / High.' },
        ],
      },
      {
        id: 'commands', title: 'The command center',
        scenes: [
          { say: "Everything you can say lives in the command center. Close to three hundred commands, split into four tabs: notes, tasks, developer, and AI snippets.", shot: 'Command center, highlight the four tabs.' },
          { say: "Search for pin, open a row, and you see the exact phrases it listens for and what it does. Every command has its own switch, so you can turn off the ones you never use.", shot: 'Type "pin" in the search; expand the first row; highlight its switch.' },
          { say: "Don't like the wording? Record your own phrase. Say it twice so AmberX knows it's really you, and from then on that phrase works too.", shot: 'Row details: the record-your-own-phrase control.' },
          { say: "And if you forget what you can say, just ask. What can I say opens the list for the page you're on, so you only see what makes sense right there.", shot: 'Voice page: the what-you-can-say panel for the current page.' },
        ],
      },
      {
        id: 'chains', title: 'Chains and wizards',
        scenes: [
          { say: "One sentence can run a whole routine. Chains string commands together. Wizards ask you questions out loud, step by step, and you answer by talking. Say cancel, back, repeat, or skip at any point.", shot: 'Chains & wizards tab; open one wizard and highlight its steps.' },
          { say: "Here's a real one. I say: note, call the landlord about the heater tomorrow. AmberX shows it on a review card first, I say save, and it's synced to the hub before I've put the phone down.", shot: 'Dictate a note; the review card; save; the synced line appears.' },
          { say: "Need an answer instead of an action? The AI snippets tab lets you ask your own notes a question out loud. It answers from your notes only, nothing made up from the internet.", shot: 'Ask my notes: a spoken question and its answer from notes.' },
        ],
      },
      {
        id: 'developer', title: 'Developer voice',
        scenes: [
          { say: "Now the fun part. The developer tab hands your words to Molly, the build agent on your server. Ask her to restart the demo app, or what's building right now.", shot: 'Developer tab; highlight a Molly command.' },
          { say: "Anything that would change your server doesn't just run. It shows up on Home as an approval, with a countdown. Deny it, approve it now, or let the clock run it for you. You stay in charge, hands-free.", shot: 'Home, a held call with its countdown; highlight Deny and Approve.' },
          { say: "That's voice control. Wake word, your own phrases, routines, and an agent that builds while you talk. Next up: how the orchestrator turns one sentence into a finished build.", shot: 'Back to Home; the series end card.' },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── 2. Orchestrator + agents
  {
    id: 'orchestrator-agents', order: 2, title: 'How the orchestrator builds everything with agents', app: 'console-web', viewport: 'desktop', skin: 'newsroom',
    hook: 'You describe it once. A crew of agents builds it in small, checked steps.',
    chapters: [
      {
        id: 'intro', title: 'One idea in, a build out',
        scenes: [
          { say: "This is the build orchestrator. It's how every feature in AmberX gets built, including the ones you're about to see. You describe what you want, and it plans the work for a crew of AI agents.", shot: 'Console, Build orchestrator open on the Pending tab with real builds.' },
          { say: "Every request becomes a build with an id, and the orchestrator splits it into small steps. Each step is ten minutes or less, and each one is pinned to a model: the heavy one where the work is hard, the faster one everywhere else.", shot: 'Open one Pending build; highlight its step list with estimates and model chips.' },
          { say: "Each build also gets a feature matrix: every piece of work as a row with its minutes, its model, and why. Untick what you don't need, and the time and cost drop before a single token is spent.", shot: 'Feature matrix of the build; untick one row and watch the totals change.' },
        ],
      },
      {
        id: 'queue', title: 'Pending, Queue, Active',
        scenes: [
          { say: "New builds wait in Pending until you say go. Move one to the Queue and you're done deciding. The dispatcher checks every minute for a free slot and an account that can run the next phase.", shot: 'Move a build from Pending to Queue; highlight the Queue card with planned model and account.' },
          { say: "When a slot opens, it starts a headless session on its own branch. The agent works through the steps in order. As each one finishes, it's committed, pushed, and ticked, so nothing is lost if a session dies. The next one picks up exactly where it stopped.", shot: 'Active tab; a running build with ticked steps and a live branch link.' },
          { say: "You never have to babysit it. Every build shows up on a live board as it moves, and if something blocks an agent, it leaves a plain note saying why, and the build waits for you instead of guessing.", shot: 'Builds page banner with progress; a build note in plain words.' },
        ],
      },
      {
        id: 'crew', title: 'Watch the crew',
        scenes: [
          { say: "Want to see who's working? Open Crew. Every agent, live: what build and step it's on in plain English, which model, how long it's been at it, and what it's costing in real time.", shot: 'Crew live; highlight the totals bar and one working agent.' },
          { say: "Open a row and you see what it's doing this second: the files it touched, the live diff, its recent tool calls. And if something looks wrong, there's a Stop button right there.", shot: 'Expand one crew row; highlight files, diff and Stop.' },
          { say: "Bigger builds can fan out to the agent swarm: specialists for Kotlin, React, Python, themes, and tests, each with a short skill sheet, its own worktree, and a token budget it can't overrun.", shot: 'Agent swarm roster with skills and budgets.' },
          { say: "Everything an agent changes is checked by code before a person ever sees it: the theme check, the controls check, the toolbar check. If a screen uses a hard-coded colour, the build fails, not your users.", shot: 'Terminal: check-theme and check-controls passing.' },
        ],
      },
      {
        id: 'checks', title: 'Checked before it lands',
        scenes: [
          { say: "Every screen an agent builds goes to UI Review with desktop and phone screenshots, and waits for a human yes. The merge queue lands the code. Agents never push to main.", shot: 'UI Review, one item with its two screenshots and Approve / Ask changes.' },
          { say: "So: describe it, queue it, watch it get built, approve what you see. Next: Plan Studio, where those ideas get planned in the first place.", shot: 'Back to the orchestrator Complete tab; end card.' },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── 3. Plan Studio
  {
    id: 'plan-studio', order: 3, title: 'Plan Studio: plan by talking, build with one tap', app: 'console-web', viewport: 'desktop', skin: 'ledger',
    hook: 'Talk through a plan like you would with a person. Turn it into a build when it is ready.',
    chapters: [
      {
        id: 'intro', title: 'Every plan in one place',
        scenes: [
          { say: "This is Plan Studio. Every plan for every app lives here: what we have, what's planned, and what's next. Let me show you how fast an idea becomes a real plan.", shot: 'Plan Studio, Plans tab in tree view with real plans and counts.' },
          { say: "You can look at plans the way you think. A tree, a grid, a board you drag cards across, a roadmap, or a clean reader. Search hits every field, and you can save the views you like.", shot: 'Switch views: tree, board, roadmap, reader.' },
          { say: "Plans are sorted into categories you control. The Categories tab shows each one with its counts, so you can see at a glance where the work is piling up.", shot: 'Categories tab with counts.' },
        ],
      },
      {
        id: 'catalog', title: 'What we have',
        scenes: [
          { say: "The Catalog tab lists every app and plugin with its features checked off as have or planned. Nobody keeps it up to date by hand. It reads the code, so it's always current.", shot: 'Catalog tab; expand one plugin and highlight have / planned ticks.' },
          { say: "When something new ships, it shows up in the catalog by itself. When something's removed, it's marked gone, so the list never lies to you.", shot: 'Catalog: a feature marked new and one marked gone.' },
        ],
      },
      {
        id: 'ai', title: 'Edit plans in plain English',
        scenes: [
          { say: "Hit plus Plan in the banner to capture an idea in one line. Then tell it what you want in plain English: add a step to export the report as a PDF, and mark it high priority.", shot: 'Banner + Plan; quick capture; type the request in the AI command box.' },
          { say: "You get a diff, not a surprise. Green is what's added, red is what's removed. Apply it or throw it away. And every change is in the history, with the words you used.", shot: 'Diff panel with Apply / Discard; then the plan history note.' },
          { say: "Each plan keeps its versions. Compare today's plan with last week's and see exactly what changed and who changed it, you or the AI.", shot: 'Plan versions; compare two versions side by side.' },
        ],
      },
      {
        id: 'voice', title: 'Plan out loud',
        scenes: [
          { say: "Or just talk. Open the voice panel and plan like you're talking to me. Say undo that, say that again, or I'm done. Big edits ask for a yes before they happen.", shot: 'Voice panel open; transcript turns and spoken replies shown.' },
          { say: "It works the same on your phone. Plans live on your hub, so a plan you start in the car with AmberX is waiting for you in the console when you sit down.", shot: 'AmberX phone with the same plan open.', app: 'amberx-droid' },
        ],
      },
      {
        id: 'build', title: 'Turn it into a build',
        scenes: [
          { say: "When the plan's ready, press Turn into a build. You see the steps in order, each with its model and a time estimate, before anything is created.", shot: 'Turn into a build preview with step order, model and estimate.' },
          { say: "Confirm, and the build lands in the orchestrator. From then on the two stay in sync: steps tick in the plan as the agents finish them, and when the build ships, its planned features flip to have.", shot: 'Orchestrator Pending with the new build; back in Plan Studio the linked plan shows progress.' },
          { say: "That's Plan Studio. Next up: how one set of tokens makes every app look the way you want, and swaps live.", shot: 'End card.' },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── 4. Skins and tokens
  {
    id: 'skins-tokens', order: 4, title: 'Skins and hot-swappable tokens', app: 'console-web', viewport: 'desktop', skin: 'atelier',
    hook: 'Change one token and every app follows, live.',
    chapters: [
      {
        id: 'intro', title: 'Everything you see is an asset',
        scenes: [
          { say: "Here's something most apps can't do. In AmberX, everything you see is an asset: every colour, size, gap, font, corner, and border. Nothing on screen is hard-coded. Watch.", shot: 'Console Home in the atelier skin.' },
          { say: "This is a skin. One pick changes the whole personality of the app: colours, type, density, layout, even how things move. Atelier, Newsroom, Ledger, Control room. Same app, same data, a different room.", shot: 'Swap skins live: atelier, newsroom, ledger, control-room; the page re-renders without a reload.' },
          { say: "A skin isn't just colour. It brings its own typography, its own spacing, its own density. Newsroom is tight and busy. Atelier breathes. Pick the one that fits how you work.", shot: 'Compare newsroom and atelier side by side; highlight type and spacing.' },
        ],
      },
      {
        id: 'studio', title: 'The hot-swap studio',
        scenes: [
          { say: "Go deeper in Settings, Appearance. Every slot in the app is listed: the banner, the nav, buttons, tabs, menus, dialogs, more than fifty types. Tap one and swap it on its own.", shot: 'Settings → Appearance → Assets; open the Tab group card and swap it.' },
          { say: "Want two tab styles at once? Untick apply settings to all, and every tab group can be set on its own. Tick it again, and they all match.", shot: 'Tab group card: Apply settings to all ticked, then unticked.' },
          { say: "Want proof nothing's glued down? This is the stress test. It swaps random slots every second, and the app keeps working the whole time.", shot: 'Hot-swap studio auto mode running for a few seconds, then stopped.' },
          { say: "Why does that work? Because every control in every app is a framework part, and every part reads its look from tokens. There are no secret one-off styles, and a check in the build makes sure it stays that way.", shot: 'Highlight a button, a tab row and a toolbar; overlay of the token names they read.' },
        ],
      },
      {
        id: 'editor', title: 'Token by token',
        scenes: [
          { say: "The theme editor shows every token, grouped and searchable. Change the accent colour, and the preview updates as you drag. Save it as your own theme.", shot: 'Theme editor, Colour section; change the accent; save as a new theme.' },
          { say: "Switch to the compare view and put two themes next to each other, token by token. Spot the difference in seconds.", shot: 'Theme editor compare view of two themes.' },
          { say: "Not sure what you want? The theme manager rolls new looks for you. Lock what you love, roll the rest. Every roll is contrast-checked, so it stays readable.", shot: 'Theme manager; lock two tokens, roll twice, undo once.' },
          { say: "Found a look you love? Save it, rename it, export it, and share it. A theme is just a small file, and anyone can import it.", shot: 'Theme manager: save, rename, export.' },
        ],
      },
      {
        id: 'everywhere', title: 'Every app follows',
        scenes: [
          { say: "Here's the part that matters. The look rides on your hub, so when you change it here, the AmberX phone app and the hub's own web app follow. One change, every screen.", shot: 'Split view: console, axhub-web and AmberX phone all showing the new accent.' },
          { say: "And it's all reachable without the UI. Set a token from the API, the command line, or just say it to AmberX. Next: the UI designer, where you put those pieces together into screens.", shot: 'Terminal running `axf token` set; the console updates; end card.' },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── 5. UI designer
  {
    id: 'ui-designer', order: 5, title: 'The UI designer: screens from building blocks', app: 'console-web', viewport: 'desktop', skin: 'clinic',
    hook: 'Design screens from real parts that already work, not pictures of parts.',
    chapters: [
      {
        id: 'intro', title: 'Real parts, not mockups',
        scenes: [
          { say: "Most design tools hand you a picture, and then someone has to build it. In AmberX, you design with the real parts. What you place is what ships.", shot: 'Console with the clinic skin; the designer area in view.' },
          { say: "A quick heads up: some of what you'll see is a preview of the full designer we're building. Anything marked Preview isn't shipped yet. The rest is live.", shot: 'Highlight the Preview label in the corner of the staged canvas.', staged: true },
        ],
      },
      {
        id: 'designers', title: 'Designers you can use today',
        scenes: [
          { say: "Today you already design menus this way. The context menu designer builds a right-click menu, item by item, with its own fonts and colours, and a floating preview that updates as you type.", shot: 'Context menu designer: add an item, change hover colour, live preview updates.' },
          { say: "Save a piece of a menu as a chunk and reuse it in any other menu. When you're done, it becomes a normal asset you can pick in Appearance, like anything else.", shot: 'Save as chunk; insert it in another menu; Use as the context menu.' },
          { say: "Toolbars work the same. Right-click a toolbar to customize it: drag buttons in, drag them out, or reorder them, and the change sticks for everyone using that toolbar.", shot: 'Toolbar customizer: drag a button in, drag one to the trash.' },
        ],
      },
      {
        id: 'canvas', title: 'Laying out a screen',
        scenes: [
          { say: "The full designer works the same way for whole screens. Pick a layout, then drag in parts from the library: a toolbar, a data grid, tabs, a form, a card.", shot: 'Staged canvas: choose a layout; drag a toolbar, data grid and form onto it.', staged: true },
          { say: "Each part comes with its behaviour already wired up. The grid sorts and filters. The form saves. The toolbar has the right labels for screen readers. You're arranging working software.", shot: 'Staged canvas: sort the grid; highlight the toolbar label.', staged: true },
          { say: "Check the phone at any time. The same screen, laid out for a small display, side by side with the desktop. No separate design for mobile.", shot: 'Staged canvas: desktop and phone previews side by side.', staged: true },
          { say: "Every size, colour, and gap still comes from the tokens you saw in the last video. Switch the skin and your new screen switches with it.", shot: 'Swap skin while the staged screen is open; it re-renders.', staged: true },
          { say: "Just like everything else in AmberX, the designer has an API. An agent can place the same parts you can, so you can say: add a search bar above the list, and watch it happen.", shot: 'Staged canvas: a spoken request adds a search bar above the grid.', staged: true },
        ],
      },
      {
        id: 'ship', title: 'From design to review',
        scenes: [
          { say: "When a screen is done, it goes where every screen goes: UI Review, with desktop and phone shots, waiting for your yes.", shot: 'UI Review item for the designed screen.' },
          { say: "Approved screens become assets themselves. Use the same layout in your next app, or hand it to an agent as the starting point.", shot: 'Asset list with the saved screen layout.', staged: true },
          { say: "That's the designer. Next: axHub, the server that keeps all of this safe and in sync.", shot: 'End card.' },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── 6. axHub
  {
    id: 'axhub', order: 6, title: 'axHub: your server, your approvals, your apps', app: 'axhub-web', viewport: 'desktop', skin: 'windows',
    hook: 'Every risky action stops at one place, and you hold the key.',
    chapters: [
      {
        id: 'intro', title: 'The hub in the middle',
        scenes: [
          { say: "Everything you've seen so far runs through one place: axHub. It's the server in the middle that holds your data, your apps, and the final say on anything risky.", shot: 'axHub web, Approvals home with real requests.' },
        ],
      },
      {
        id: 'approvals', title: 'Approvals',
        scenes: [
          { say: "When an agent wants to write a file, delete something, or run a command on your server, the request stops here first. Each one says what it is in plain words, with the time left.", shot: 'Approvals list; highlight the plain-words title and the time left.' },
          { say: "Some calls are held: they run on their own when the clock hits zero, unless you veto them. Others wait for an explicit yes. Either way, a human makes the call.", shot: 'A held call with its countdown; Review on the hub.' },
          { say: "Tap Review on the hub, and you land on the hub's own approval page, with the full details: who asked, what tool, the exact command. That page is the only place a decision is made.", shot: 'Hub approval page with full request details.' },
          { say: "The same queue shows up everywhere you are: in the console banner, on AmberX on your phone, and here. Approve it in one place and it's gone from all of them.", shot: 'Console banner count and AmberX Home showing the same request.', app: 'console-web' },
        ],
      },
      {
        id: 'hub', title: 'Hub status and apps',
        scenes: [
          { say: "The Hub page tells you if you're signed in, how many things are waiting, and when it last checked, with one-tap links to apps, users, and your account.", shot: 'Hub tab; highlight sign-in state and the waiting count.' },
          { say: "Apps is your private app store. Every app you build shows up with a download button and its earlier versions, so rolling back is one tap.", shot: 'Apps tab; expand one app to show earlier builds.' },
          { say: "The Manage section is where the hub's own admin screens are coming: services, jobs, the audit log, the vault, users, projects, and devices. Each one says plainly what it will do and what it's waiting on.", shot: 'Manage section; open Audit log and show its plain note.' },
        ],
      },
      {
        id: 'safe', title: 'Safe by design',
        scenes: [
          { say: "The web app never holds a hub token. It uses your own browser session, refuses redirects, and rebuilds every download link from the hub's own address. Nothing on this page can approve anything behind your back.", shot: 'Security notes on the Hub tab; highlight Review on the hub.' },
          { say: "The hub also holds the shared memory your agents use. Plans, notes, and build records live there, so every agent and every device works from the same truth.", shot: 'Hub tab; project data link and shared memory path.' },
          { say: "And because it's built on the same framework, it wears the same look as everything else. Change your theme in the console, and the hub follows.", shot: 'Swap the hub look; axhub-web re-renders.' },
          { say: "There's an Android version of the hub app too, laid out the same way, so you're never lost moving between your phone and your desk.", shot: 'Phone: AXHub Android approvals.', app: 'axhub-android' },
          { say: "That's axHub. In the last video, I'll put it all together and build an app from start to finish.", shot: 'End card.' },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── 7. End to end
  {
    id: 'build-an-app', order: 7, title: 'Building an app, start to finish', app: 'console-web', viewport: 'desktop', skin: 'atelier',
    hook: 'From one sentence to an app on your phone, without writing code.',
    chapters: [
      {
        id: 'idea', title: 'Say what you want',
        scenes: [
          { say: "Let's build an app from scratch. A simple one: a time tracker for work. Start, stop, a list of today's hours, and a weekly total. Watch the whole thing, start to finish.", shot: 'AmberX on a phone, voice panel open.', app: 'amberx-droid' },
          { say: "I say it to AmberX in plain English. Plan Studio writes it up as a plan: the screens, the data, and the features, checked against what the framework already has.", shot: 'Plan Studio: the new time-tracker plan with its features and steps.' },
          { say: "Before anything's built, I see the feature matrix: each feature with its minutes and its model. I drop the export-to-spreadsheet idea for now, and the estimate shrinks.", shot: 'Feature matrix of the time-tracker build; untick one row.' },
        ],
      },
      {
        id: 'parts', title: 'Pick the parts',
        scenes: [
          { say: "Most of this app already exists as parts. Storage, sync with the hub, settings, notifications, data grids. The library matrix shows what's ready, so we tick the ones we need instead of building them again.", shot: 'Library matrix with the needed libraries ticked.', staged: true },
          { say: "The app starts from the Android template. One command creates the project with the framework wired in, a settings screen, and a default asset in every slot.", shot: 'Terminal: template init for android-compose, then `axf validate` passing.' },
        ],
      },
      {
        id: 'design', title: 'Design the screens',
        scenes: [
          { say: "In the designer, I lay out the two screens: a big start-stop button and today's list, and a week view with totals. Every part is real, and every colour comes from tokens. This canvas is a preview.", shot: 'Staged designer canvas: Today and Week screens assembled.', staged: true },
          { say: "I pick a skin I like and save the look as my own asset, so the next app I build can start with it.", shot: 'Apply a skin; save the look as an asset.' },
          { say: "Every action in the app gets an API too. Start a timer from the command line, from an agent, or by saying start work to AmberX. No feature is buttons only.", shot: 'Staged: the time tracker action list with REST, CLI and voice entries.', staged: true },
        ],
      },
      {
        id: 'build', title: 'Let the crew build it',
        scenes: [
          { say: "Turn into a build. The orchestrator splits it into short steps, queues it, and the agents get to work. I can watch them in Crew, file by file, and approve anything that touches the server.", shot: 'Turn into a build; orchestrator Queue; Crew live with the build running.' },
          { say: "While they work, the plan in Plan Studio ticks along with them, step by step, so I always know how far along it is.", shot: 'Plan Studio: the time-tracker plan with ticked steps.' },
          { say: "The screens come back to UI Review with desktop and phone shots. I approve them, and the merge queue lands the code.", shot: 'UI Review item approved.' },
        ],
      },
      {
        id: 'ship', title: 'On your phone',
        scenes: [
          { say: "The finished app shows up in axHub's app store. Tap download, install, and it's on the phone, wearing the look I picked.", shot: 'axHub Apps with the new app; phone install; the app running.', staged: true },
          { say: "That's AmberX. You describe it, it plans it, a crew builds it, you approve it, and it's yours. Thanks for watching. Join the waitlist and talk your first app into existence.", shot: 'End card with the waitlist link.' },
        ],
      },
    ],
  },
];

/** Every scene of a video, in order, with its chapter id. */
export function scenesOf(video) {
  return video.chapters.flatMap((c) => c.scenes.map((s) => ({ chapter: c.id, app: video.app, ...s })));
}

/** Spoken words in a video. */
export function wordCount(video) {
  return scenesOf(video).reduce((n, s) => n + s.say.trim().split(/\s+/).length, 0);
}

/** Estimated running time in seconds at the series pace, plus a short beat between scenes. */
export function estimateSeconds(video, wpm = SERIES.wordsPerMinute) {
  const scenes = scenesOf(video);
  return Math.round((wordCount(video) / wpm) * 60 + scenes.length * 0.6);
}
