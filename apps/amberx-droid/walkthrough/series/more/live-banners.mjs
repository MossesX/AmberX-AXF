// Step s21 (1 of 3): live banners doing real work, and a shell into a container through tmux.
export default {
  id: 'live-banners', step: 's21', kind: 'deep', title: 'Live banners, GitHub, and a shell anywhere',
  app: 'console-web', viewport: 'desktop', skin: 'newsroom',
  hook: 'Watch the console fix, merge and land things on its own, then step into any container.',
  facts: [
    'Push banner (push-banner plugin): every branch not on main (ahead/behind, age, its PR and CI); every change reaches main only through its PR, brought up to date with main and re-tested before it merges; auto-merge takes ready PRs oldest first. The landing list shows every finished build in landing order with what it waits on. Landin\' Lenny runs the merge queue (batch testing, landed, kicked out).',
    'Systems check (Ping Paulie): red items, auto-fix started / ran / failed, green again; anything that needs the owner, such as a missing key, is a systems check item with the exact steps.',
    'Banner widgets (BANNER-WIDGETS.md): pick, order and size widgets; settings per widget; overflow into the ⋯ menu; saved per app and form factor through axHub.',
    'Terminal: a shell or Claude Code on any connection (console container, VPS root, any container, axHub) through tmux; container access goes through a locked-down proxy with an audit log.',
    'No staged scenes: recorded on a real afternoon with live banner activity.',
  ],
  chapters: [
    {
      id: 'banner', title: 'The banner is alive',
      scenes: [
        { say: "Hi, I'm Amber. Everything here is live, recorded on a normal working afternoon. That strip across the top of the console isn't decoration. Every widget on it is doing a job right now.", shot: 'Console with the top banner in view; widgets animating.' },
        { say: "Each widget has its own settings too: how big it is, what it shows, its priority, whether it may hide when there's no room. Your layout is saved per app, and separately for phone and computer.", shot: 'A widget\'s settings panel; the same banner on a phone with a different arrangement.' },
        { say: "Right-click it and pick Widgets. Choose what sits there, in what order, and how much room each one gets. Out of room? The least important ones tuck into a menu and come back when there's space.", shot: 'Widgets picker: reorder two widgets; shrink the window; widgets move into the overflow menu.' },
      ],
    },
    {
      id: 'fix', title: 'Fixing itself',
      scenes: [
        { say: "Here's the systems check widget. A check just went red: a service stopped answering. Ping Paulie starts the auto-fix. The chip spins, then goes green. Nobody touched anything.", shot: 'The systems check chip red; auto-fix running; green again; the event line.' },
        { say: "Some fixes need you. This one says add this key, with the exact steps: which setting, what to paste, where to get it. It waits there until it's done, and checks itself again after.", shot: 'A systems check item with its exact steps.' },
      ],
    },
    {
      id: 'merge', title: 'The merge queue',
      scenes: [
        { say: "Now GitHub. The push banner lists every branch that isn't on main yet: how far ahead and behind, how old, its pull request and its checks.", shot: 'Push banner open: branches with ahead/behind, PR and CI state.' },
        { say: "Nothing goes to main except through its pull request. Before it merges, it's brought up to date with main and tested again. Watch this one: updating, testing, passed.", shot: 'One branch moving through updating, CI running, passed.' },
        { say: "Landin' Lenny batches ready ones together, tests the batch, and lands it. If one breaks the batch, he kicks it out and lands the rest.", shot: 'The landing list: a batch testing; one kicked out; the rest landed.' },
        { say: "Merged. The banner shows main moving forward, and the console pulls main so it's running the newest code.", shot: 'The landed chip; main pulled; the build count on main ticking up.' },
      ],
    },
    {
      id: 'repair', title: 'Repairs',
      scenes: [
        { say: "Sometimes a branch falls too far behind, or its checks fail on something unrelated. The banner marks it, and a repair job brings it up to date and re-runs it, with a note saying what happened.", shot: 'A branch flagged behind; the repair job; its note.' },
      ],
    },
    {
      id: 'shell', title: 'A shell into any container',
      scenes: [
        { say: "And when you want to look for yourself, open the Terminal, pick a connection, and choose a container. You're in, through tmux, so the session survives a closed tab or a dropped connection.", shot: 'Terminal: the connection picker; pick a container; a shell prompt.' },
        { say: "Close the tab. Open it again from the phone. Same session, same scrollback, right where you left it.", shot: 'Close the tab; open the same tmux session from the phone; the scrollback is there.' },
        { say: "Container access goes through one locked-down door, with an audit log of every change. A console that fixes, merges and lands on its own, and lets you step in anywhere. Join the waitlist.", shot: 'Container access audit log; end card.' },
      ],
    },
  ],
};
