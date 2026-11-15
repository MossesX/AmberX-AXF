// Step s21 (2 of 3): notes, tasks and to-dos, nestable to any depth.
export default {
  id: 'nested-notes', step: 's21', kind: 'deep', title: 'Notes inside tasks inside notes',
  app: 'console-web', viewport: 'desktop', skin: 'ledger',
  hook: 'One kind of item that can hold any other, as deep as you like.',
  facts: [
    'Real today: the console To-do manager (lists with nested groups; notes, to-dos and tasks with status, priority, due dates and tags), AmberX notes and tasks on axHub (amberx-notes@1), the control@1 CLI aliases axf note | todo | task | list, and voice capture into a list.',
    'Notes & tasks (notes-tasks@1, apps/console-web/plugins/notes-tasks/DESIGN.md, Nov 13 2026): one item type whose look is note, to-do, task or list; any item can hold any other with no depth limit. The contract is written; the plugin code has not landed, so the any-depth nesting scenes are staged.',
  ],
  chapters: [
    {
      id: 'today', title: 'What you have today',
      scenes: [
        { say: "Hi, I'm Amber. Part of this is live, and the deep nesting you'll see is a preview of the new Notes and Tasks, which is designed and on its way. Let's start with what works right now.", shot: 'Console To-do manager; the Preview legend fades in.' },
        { say: "The To-do manager keeps lists, with groups inside them, holding notes, to-dos and tasks. Each one has a status, a priority, a due date and tags.", shot: 'To-do manager: a list with groups; open a task with its fields.' },
        { say: "Groups fold away, so a busy list stays readable. Filter by status or priority, and only what matters today is left on screen.", shot: 'To-do manager: fold groups; filter to high priority, open.' },
        { say: "On the phone, say note, or add a task, and it lands in the same place on axHub. And from the command line, axf todo adds one without opening anything.", shot: 'AmberX voice note into a list; then the terminal: axf todo add.' },
      ],
    },
    {
      id: 'nest', title: 'As deep as you want',
      scenes: [
        { staged: true, say: "Now the new model, as a preview. There's only one kind of item. What it looks like, a note, a to-do, a task or a list, is just its look, and you can switch it any time without losing anything.", shot: 'Staged: one item switching look between note, to-do, task and list; its fields stay.' },
        { staged: true, say: "And any item can hold any other. Here's a note about the kitchen remodel. Inside it, a task: get quotes. Inside the task, a checklist of three contractors. Inside one contractor, a note from the call.", shot: 'Staged: the tree expanding four levels deep.' },
        { staged: true, say: "Keep going. Inside that call note, another to-do list. There's no limit, and no rule about what can go where.", shot: 'Staged: a fifth and sixth level.' },
        { staged: true, say: "Create by typing or by voice. Add a to-do under get quotes: ask about permits. It lands right where you said.", shot: 'Staged: a spoken add; the new to-do appears under the task.' },
        { staged: true, say: "Drag an item to move it, with everything inside it. The checklist moves from the remodel note to the budget note, contractors, call notes and all.", shot: 'Staged: drag a subtree to another parent.' },
      ],
    },
    {
      id: 'check', title: 'Check off and find',
      scenes: [
        { staged: true, say: "Turn the call note into a task with one switch, and it keeps its text, its children and its place. Nothing is lost when an idea becomes work.", shot: 'Staged: change the look from note to task; its children stay.' },
        { staged: true, say: "Check things off at any level. Tick the last contractor, and the task above shows three of three. The note above that shows its progress too.", shot: 'Staged: ticks rolling up as progress through the levels.' },
        { staged: true, say: "Search finds anything, at any depth, and shows you the path to it: kitchen remodel, get quotes, contractor two, call notes.", shot: 'Staged: search for permits; the result with its breadcrumb path.' },
        { say: "Everything you just saw stores on axHub and has the same command for voice, the command line, an agent or a script. Join the waitlist.", shot: 'The control command list for notes and to-dos; end card.' },
      ],
    },
  ],
};
