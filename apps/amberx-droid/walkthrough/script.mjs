// The AmberX walkthrough (walkthrough-video@1): chapters → scenes { say, act }. `say` is Amber's narration (Piper
// voice, also the captions); `act` drives the live app at amberx.amberxai.com (phone layout, demo data from seed.mts)
// with the helpers in record.mjs: nav, hl (highlight a control with a label), click, type, scroll, calm (close popups),
// settings (open a Settings tab), menu (open an app-menu path). Each scene is held until its voice clip ends.
// Edit the words or steps here, then re-record: bash apps/amberx-droid/walkthrough/rebuild.sh
// Facts must match the app (apps/amberx-droid/README.md); things not built are left out, not promised.

export const WALKTHROUGH = {
  $axf: 'walkthrough-video@1',
  id: 'amberx-app',
  title: 'AmberX walkthrough',
  app: 'amberx-droid',
  url: 'https://amberx.amberxai.com/',
  viewport: { width: 412, height: 915 },
  voice: 'en_US-kristin-medium',
};

export const CHAPTERS = [
  {
    id: 'welcome', title: 'Welcome to AmberX', start: 'home',
    scenes: [
      { say: "Hey, I'm Amber. This is AmberX, your pocket control room for everything running on your hub. Notes, tasks, voice, agents, and every approval, all in one wicked simple app. Stick with me, kid, this won't take long.", act: async (h) => { await h.calm(); await h.hl('.fx-banner', 'The banner'); } },
      { say: "Up top is the banner. It shows the time, the AI that's answering, and how many calls are waiting on you. That little number is the one to watch.", act: async (h) => { await h.hl('.fx-banner .fx-widget-counter', 'Calls waiting'); } },
      { say: "Down at the bottom is the nav bar. Swipe it sideways and every page is right there: home, settings, ask my notes, terminal, the command center, dictate, voice, notes, tasks, and the rest.", act: async (h) => { await h.hl('.fx-region--nav', 'Every page'); await h.navScroll(600); await h.wait(1500); await h.navScroll(-600); } },
      { say: "Can't find something? The search box up top finds any page, setting, or command. Type a word and go.", act: async (h) => { await h.hl('.fx-banner .fx-search', 'Search'); } },
      { say: "Every chapter in this video is skippable. Tap the chapter list in the player and jump right to the part you care about. Bet.", act: async (h) => { await h.wait(500); } },
    ],
  },
  {
    id: 'home', title: 'Home: approvals', start: 'home',
    scenes: [
      { say: "This is Home. Anything on your hub that wants to write, delete, or run a command lands here first. Nothing sneaks by you.", act: async (h) => { await h.calm(); await h.hl('h1, h2', 'Home'); } },
      { say: "Each row says what it is in plain words, then the tool it calls. That chip on the left tells you who asked: Claude Code, an agent like Molly, or a Claude chat.", act: async (h) => { await h.hl('text=Restart the demo web app', 'What it is'); await h.wait(2500); await h.hl('text=/^Agent$/', 'Who asked'); } },
      { say: "This top one is a held call. It runs by itself when the countdown hits zero, unless you stop it. That's the veto system: you don't have to do anything to let it go.", act: async (h) => { await h.hl('text=/runs in/', 'Countdown'); } },
      { say: "Tap Show the details and the row opens up. You get the full command, when it was asked, and its timeline. No guessing what you're signing off on.", act: async (h) => { await h.click('role=button[name="Show the details"] >> nth=0', 'Show the details'); await h.wait(1500); await h.scroll(250); } },
      { say: "Deny stops it cold. Approve runs it right now, no waiting. On a held call there's also Shelve, which pauses the clock until you make up your mind.", act: async (h) => { await h.scroll(-400); await h.hl('role=button[name="Deny"] >> nth=0', 'Deny'); await h.wait(1800); await h.hl('role=button[name="Approve"] >> nth=0', 'Approve now'); } },
      { say: "When a new call shows up, AmberX pops it right up in your face, like this. A big countdown with the time left, what's about to run, and the same three buttons. Wicked hard to miss, kid.", act: async (h) => { await h.openHeld(); await h.hl('text=/until axHub runs it/', 'Time left'); await h.wait(2500); await h.hl('[role=dialog] button:has-text("Shelve")', 'Shelve'); } },
      { say: "Check now asks the hub again right away, Hub page opens the full approvals page on axHub, and Window pops this page into its own floating window.", act: async (h) => { await h.calm(); await h.hl('role=button[name="Check now"]', 'Check now'); await h.wait(1600); await h.hl('role=button[name="Hub page"]', 'Hub page'); await h.wait(1600); await h.hl('role=button[name="Window"]', 'Window'); } },
    ],
  },
  {
    id: 'terminal', title: 'Terminal', start: 'Terminal',
    scenes: [
      { say: "Terminal is the hands-on view of the held commands. Each one with its countdown and Deny, Approve, and Shelve right on the line.", act: async (h) => { await h.calm(); await h.hl('text=Restart the demo web app', 'Held command'); } },
      { say: "It's the fast lane when a build is firing commands at you. Read the line, make the call, move on.", act: async (h) => { await h.hl('role=button[name="Deny"] >> nth=0', 'One tap'); } },
    ],
  },
  {
    id: 'command-center', title: 'Command center', start: 'Command center',
    scenes: [
      { say: "This is the command center. Close to three hundred voice commands, sorted into four tabs: notes, tasks, developer, and AI snippets.", act: async (h) => { await h.calm(); await h.hl('[role=tablist] >> nth=0', 'Four tabs'); } },
      { say: "Search it, sort it, filter it. Every row opens up to show the phrases it listens for and what it does.", act: async (h) => { await h.type('input[placeholder*="what you"]', 'pin'); await h.wait(1500); await h.click('role=button[name="Expand row"] >> nth=0', 'Open a command'); } },
      { say: "Each command has its own switch, so you can turn off anything you never use. Record your own phrase, say it twice so AmberX knows it's really you, or pick a ready-made one.", act: async (h) => { await h.hl('[role=switch] >> nth=0', 'On or off'); await h.wait(2500); await h.scroll(300); } },
      { say: "Chains and wizards string commands together. One phrase, a whole routine. The voice wizard walks you through building one, out loud, step by step.", act: async (h) => { await h.scroll(-600); await h.clear('input[placeholder*="what you"]'); await h.click('role=tab[name=/Chains/]', 'Chains & wizards'); } },
      { say: "The developer tab is where Molly lives. More on her in a minute.", act: async (h) => { await h.click('role=tab[name=/Developer/]', 'Developer'); } },
    ],
  },
  {
    id: 'dictate', title: 'Dictate and voice notes', start: 'Dictate',
    scenes: [
      { say: "Dictate is hands-free note taking. Tap Start dictating and just talk. Say your piece, pause, and AmberX writes it up.", act: async (h) => { await h.calm(); await h.hl('role=button[name="Start dictating"]', 'Start dictating'); } },
      { say: "When you're done you get a review card. Fix a word, pick the list, then save. It's saved once, on the hub, no copies scattered around.", act: async (h) => { await h.wait(500); } },
      { say: "Here's the same thing typed, so you can see it land. Quick add, type the note, hit Add.", act: async (h) => { await h.go('Notes'); await h.calm(); await h.type('textarea >> nth=0', 'Pick up the banner from the print shop Thursday'); await h.wait(600); await h.click('role=button[name="Add"]', 'Add'); } },
      { say: "There it is, one note, right on top, and the line up here says it's synced with the hub. Every device you sign in on sees it.", act: async (h) => { await h.hl('text=Pick up the banner', 'Saved once'); await h.wait(2500); await h.hl('text=/Synced with axHub/', 'On the hub'); } },
      { say: "Voice notes from the dev console and Voice Vault show up here too, under their own list, read only, so you never lose a thought.", act: async (h) => { await h.click('role=tab[name=/Lists/]', 'Lists'); } },
    ],
  },
  {
    id: 'notes', title: 'Notes and tasks', start: 'Notes',
    scenes: [
      { say: "Notes lives in lists. Inbox catches everything, then you've got your own lists and sub-lists, like Groceries inside Home.", act: async (h) => { await h.calm(); await h.click('role=tab[name=/Lists/]', 'Lists'); } },
      { say: "Pinned keeps the important stuff on top, and Search finds anything, fast.", act: async (h) => { await h.click('role=tab[name=/Pinned/]', 'Pinned'); await h.wait(2500); await h.click('role=tab[name=/Search/]', 'Search'); } },
      { say: "Tasks is the to-do side. Today, upcoming, and done, with due dates, priorities, checklists, and subtasks.", act: async (h) => { await h.go('Tasks'); await h.calm(); await h.hl('h1, h2', 'Tasks'); } },
      { say: "Flip between today, upcoming, and done up top, or switch to a grid and sort by due date or priority.", act: async (h) => { await h.click('role=tab >> nth=1', 'Upcoming'); await h.wait(2000); await h.click('role=tab >> nth=0', 'Today'); } },
      { say: "That little number on the Tasks button? That's what's due today. Say add a todo, buy lemons, by Friday, and it's on the list.", act: async (h) => { await h.hl('.fx-nav__item[title="Tasks"]', 'Due today'); } },
    ],
  },
  {
    id: 'web', title: 'Web pages and clips', start: 'Web',
    scenes: [
      { say: "Web opens pages right inside AmberX, in tabs. Bookmark one, or clip a piece of a page and it lands in your notes as a web clip.", act: async (h) => { await h.calm(); await h.hl('h1, h2', 'Web'); } },
      { say: "Clips keep the page address, so you can always get back to where you found it.", act: async (h) => { await h.scroll(300); } },
    ],
  },
  {
    id: 'ask', title: 'Ask my notes', start: 'Ask my notes',
    scenes: [
      { say: "Ask my notes. Type a question, or say it, and the AI answers from your notes. Only your notes. It doesn't make stuff up.", act: async (h) => { await h.calm(); await h.hl('textarea, input[type=text]', 'Your question'); } },
      { say: "Watch. What's due for work this week?", act: async (h) => { await h.type('textarea, input[type=text]', "What's due for work this week?"); await h.click('role=button[name="Ask"]', 'Ask'); } },
      { say: "And there's your answer: the launch email today, the landing page review tomorrow. Pissah.", act: async (h) => { await h.wait(1500); await h.scroll(200); } },
      { say: "The AI itself is set up under AI connection. Claude on your plan or the API, other providers as backups if one goes down. The keys stay on the AmberX server, never on your phone.", act: async (h) => { await h.settings('Plugins', 'AI connection'); await h.wait(1500); await h.scroll(300); } },
    ],
  },
  {
    id: 'voice', title: 'Voice and the overlay', start: 'Voice',
    scenes: [
      { say: "This is the voice page. Hit Speak, or turn on hands-free and AmberX listens for its wake phrase, on screen and in the background.", act: async (h) => { await h.calm(); await h.hl('role=button[name="Speak"] >> nth=0', 'Speak'); } },
      { say: "Always armed means it acts on everything it hears, no wake phrase. Handy in the car, kid.", act: async (h) => { await h.hl('text=Always armed', 'Always armed'); } },
      { say: "Below that is everything you can say, with what each phrase does.", act: async (h) => { await h.scroll(500); await h.hl('text=/What you can say/', 'What you can say'); } },
      { say: "On the phone there's also the overlay: a small floating panel over your other apps showing the mic level, what was heard, and quick settings. You switch it on in voice control settings.", act: async (h) => { await h.settings('Plugins', 'Voice control'); await h.hl('text=/overlay/i', 'Overlay'); } },
    ],
  },
  {
    id: 'molly', title: 'Agent Molly', start: 'Command center',
    scenes: [
      { say: "Meet Molly. She's the hub's agent, like Vinny and Mosses on the console. She knows the code, answers questions about the app, and builds or fixes things in any container.", act: async (h) => { await h.calm(); await h.click('role=tab[name=/Developer/]', 'Developer commands'); } },
      { say: "Developer commands go through Molly. Anything she runs on the server is a veto call, so it lands on your Home page first, with a countdown and a Deny button.", act: async (h) => { await h.scroll(300); await h.wait(1500); await h.scroll(-300); } },
      { say: "She also does walkthroughs: ask her how to do something and she'll walk you through it in a floating window, one step at a time.", act: async (h) => { await h.wait(500); } },
    ],
  },
  {
    id: 'recorder', title: 'Audio out and session recording', start: 'Audio out',
    scenes: [
      { say: "Audio out is the audio output recorder. One switch records what the phone plays, never the microphone, in thirty-minute chunks sent to the hub.", act: async (h) => { await h.calm(); await h.hl('h1, h2', 'Audio out'); } },
      { say: "Android asks for your OK every time it starts and shows a notification while it records. Each chunk stays on the phone until the hub says it got it.", act: async (h) => { await h.scroll(300); } },
      { say: "That's also how sessions get recorded. When a Claude session starts, it asks the hub to record. You tap Approve once, and the parts show up on the hub under the session's name.", act: async (h) => { await h.scroll(-300); } },
      { say: "Quality, chunk length, and how much the phone holds while you're offline are all in its settings.", act: async (h) => { await h.settings('Plugins', 'Audio Output Recorder'); } },
    ],
  },
  {
    id: 'monitor', title: 'Monitor', start: 'Monitor',
    scenes: [
      { say: "Monitor keeps watching the hub in the background, so approvals and alerts reach the phone even when the app's closed.", act: async (h) => { await h.calm(); await h.hl('text=/Watching/', 'Watching'); } },
      { say: "Auto-approval lets the phone wave through the calls you trust, by rule, and every one it approves still shows in the log.", act: async (h) => { await h.settings('Plugins', 'Monitoring'); await h.wait(1200); await h.scroll(350); } },
      { say: "AmberX is the phone's one source of hub notifications. Auto-approval rules and the wake phrase live right here in monitoring settings.", act: async (h) => { await h.scroll(-350); } },
    ],
  },
  {
    id: 'settings', title: 'Settings', start: 'Settings',
    scenes: [
      { say: "Settings. Up top is the level toolbar: simple, basic, developer, or administrator. Pick one and you only see what you need. Administrator shows it all.", act: async (h) => { await h.calm(); await h.level('Administrator'); } },
      { say: "Appearance is the look. Every piece of the screen is a swappable asset, so a theme change hits the whole app at once.", act: async (h) => { await h.settingsTab('Appearance'); await h.wait(1500); await h.scroll(400); } },
      { say: "Like this. Flip to dark, flip back. Same app, new coat of paint.", act: async (h) => { await h.scroll(-800); await h.click('role=button[name=/Switch to (Dark|Light) theme/]', 'Theme'); await h.wait(2000); await h.click('role=button[name=/Switch to (Dark|Light) theme/]', 'Theme'); } },
      { say: "Account and security has the privacy switch: hide sensitive screens from recordings. When it's on, any screen with a password, key, or vault field is blocked from screenshots and screen recording.", act: async (h) => { await h.settingsTab('Account'); await h.hl('text=Hide sensitive screens from recordings', 'Hide sensitive screens'); } },
      { say: "And Plugins lists everything installed, each with its own settings tab, info, and an on and off switch.", act: async (h) => { await h.settingsTab('Plugins'); await h.wait(1500); await h.scroll(300); } },
    ],
  },
  {
    id: 'hub', title: 'Hub links and the menu', start: 'home',
    scenes: [
      { say: "The menu bar up top ties it all together: the dev console, builds, plugins, your other apps, and the AmberX menu.", act: async (h) => { await h.calm(); await h.hl('.fx-menubar, [role=menubar]', 'App menu'); } },
      { say: "Apps jumps to the hub's app list. Hub page and Open on the hub take you straight to axHub, signed in, same session.", act: async (h) => { await h.menu('Apps'); await h.wait(2500); await h.calm(); } },
      { say: "And Help is where this video lives. Watch the walkthrough, any time you need a refresher. It's on the bottom of Home too.", act: async (h) => { await h.menu('Help'); await h.hl('[role=menuitem]:has-text("Watch the walkthrough")', 'This video'); await h.wait(2500); await h.go('home'); await h.scroll(1500); await h.hl('role=button[name="Watch the walkthrough"]', 'Walkthrough'); } },
    ],
  },
  {
    id: 'closing', title: "That's AmberX", start: 'home',
    scenes: [
      { say: "That's AmberX. Approvals with a veto, notes and tasks by voice, a command center, Molly, recording, and a look you can swap in a tap. Go get after it, kid. Amber out.", act: async (h) => { await h.calm(); await h.wait(1000); } },
    ],
  },
];

/** walkthrough-video@1 rules (check.mjs and the app's player rely on them). */
export function walkthroughErrors(meta = WALKTHROUGH, chapters = CHAPTERS) {
  const errors = [];
  if (meta.$axf !== 'walkthrough-video@1') errors.push('meta.$axf must be walkthrough-video@1');
  if (!meta.id || !meta.title) errors.push('meta needs id and title');
  if (!Array.isArray(chapters) || !chapters.length) errors.push('no chapters');
  const ids = new Set();
  for (const [i, c] of (chapters ?? []).entries()) {
    const at = `chapter ${i + 1} (${c?.id ?? '?'})`;
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(c?.id ?? '')) errors.push(`${at}: id must be lower-case words with dashes`);
    if (ids.has(c?.id)) errors.push(`${at}: duplicate id`);
    ids.add(c?.id);
    if (!c?.title || c.title.length > 60) errors.push(`${at}: title needed (60 characters at most)`);
    if (!Array.isArray(c?.scenes) || !c.scenes.length) { errors.push(`${at}: no scenes`); continue; }
    for (const [k, s] of c.scenes.entries()) {
      if (typeof s?.say !== 'string' || s.say.trim().length < 10) errors.push(`${at} scene ${k + 1}: narration too short`);
      if (s?.say?.length > 400) errors.push(`${at} scene ${k + 1}: narration over 400 characters (split it)`);
      if (typeof s?.act !== 'function') errors.push(`${at} scene ${k + 1}: act must be a function`);
      if (/\b(fuck|shit|damn|bitch|ass)\b/i.test(s?.say ?? '')) errors.push(`${at} scene ${k + 1}: keep the narration clean`);
    }
  }
  return errors;
}
