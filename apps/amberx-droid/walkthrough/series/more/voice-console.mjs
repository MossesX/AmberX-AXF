// Step s18 (2 of 4): running the whole console and builds by voice from the phone.
export default {
  id: 'voice-console', step: 's18', kind: 'deep', title: 'Run the console by voice',
  app: 'amberx-droid', viewport: 'phone', skin: 'control-room',
  hook: 'Every tab, screen, setting and build, by voice, from your phone.',
  facts: [
    'console-control@1 (framework/spec/CONSOLE-CONTROL.md, Nov 13 2026): one address and ten verbs for everything the console shows, shared by the console server, MCP, the CLI and voice.',
    'AmberX voice: offline wake word, the command center (close to 300 commands across notes, tasks, developer and AI snippets), wake sensitivity, custom phrases.',
    'Gizmo is the AmberX companion agent; held calls count down on the phone (veto@1).',
    'Every build action (approve, stop, raise a model) is an orchestrator act; owner-only ones stay with the owner.',
    'Staged: Gizmo announcing build events out loud on his own. The hard build limit only changes from Brett\'s signed-in console (build-limit@1).',
  ],
  chapters: [
    {
      id: 'wake', title: 'Wake it',
      scenes: [
        { say: "Hi, I'm Amber, and everything here is live. Video one showed voice for notes and tasks. This one is about running the whole console, and your builds, without touching a screen.", shot: 'Phone on a desk stand, AmberX Home; the wake chip IDLE.' },
        { say: "Amber X. Open the build orchestrator. The console on the laptop across the room jumps to it. Every tab, screen and setting has an address, so a sentence can reach it.", shot: 'Split: the phone listening; the laptop console navigating to the orchestrator.' },
        { say: "Show the Queue. Scroll down. Open the second one. Ten verbs cover it: show, open, scroll, set, and the rest. The same verbs an agent uses, and the same ones the command line uses.", shot: 'The console following each spoken command.' },
      ],
    },
    {
      id: 'builds', title: 'Builds by voice',
      scenes: [
        { say: "What's building right now? Gizmo answers out loud: three running, two queued, one waiting on you.", shot: 'Phone: the spoken reply with the list on screen.' },
        { say: "What's waiting on me? A model raise for a step that needs Fable. Approve it. The orchestrator records who decided and when.", shot: 'The approval card; spoken approve; the note on the build.' },
        { say: "Stop the build that's stuck on the merge. It asks before stopping, because stopping loses work in progress. Yes. Stopped, with a note saying why.", shot: 'Spoken stop; the confirm prompt; the build stopped with a note.' },
        { say: "Make a note on the video build: record the orchestrator video on a quiet afternoon. The note lands on the build for whoever picks it up next.", shot: 'The note appearing on the build card.' },
      ],
    },
    {
      id: 'settings', title: 'Settings by voice',
      scenes: [
        { say: "Settings too. Set the agent cap to six. That one changes the server, so it's held with a countdown instead of running right away. Let it run.", shot: 'The held call counting down on the phone; it runs; the setting shows six.' },
        { say: "Switch the console skin to Newsroom. The laptop repaints while I'm still talking.", shot: 'The console repaints in Newsroom.' },
        { say: "Raise the hard build limit to ten. That one only changes from the owner's own signed-in console, so it says so and tells you where to do it. Some switches are owner-only on purpose, and voice doesn't get around that.", shot: 'A spoken change refused with the reason and a link to the screen.' },
        { say: "When a build session starts, bring the terminal to the front. One setting, deep in the Terminal's plugin settings, found and changed by name.", shot: 'Settings → Plugins → Terminal opening at the session-start choice; it changes from Quiet to Front.' },
      ],
    },
    {
      id: 'close', title: 'Hands free',
      scenes: [
        { staged: true, say: "It works the other way too, and this part is a preview. When a build lands or a check goes red, Gizmo tells you out loud, once, with the build name and what to do next. Say open it, and the console is there.", shot: 'A spoken alert on the phone; open it; the console jumps to the build.' },
        { say: "Everything you just saw is also an API call and a command line, so anything you can say, a script or an agent can do the same way.", shot: 'Terminal: the same command run from the CLI, the console following.' },
        { say: "Forgot what you can say? Ask. What can I say here lists the commands for the screen you're on.", shot: 'The what-you-can-say panel on the phone.' },
        { say: "The whole console, every build, every setting, by voice from your phone. Join the waitlist.", shot: 'End card.' },
      ],
    },
  ],
};
