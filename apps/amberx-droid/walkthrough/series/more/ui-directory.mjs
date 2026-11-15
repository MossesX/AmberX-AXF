// Step s18 (4 of 4): the UI directory, floating toolbars and tab groups, and the Assets menu.
export default {
  id: 'ui-directory', step: 's18', kind: 'deep', title: 'Every screen, one window away',
  app: 'console-web', viewport: 'desktop', skin: 'clinic',
  hook: 'Find any screen, build your own toolbar on any page, and hide what you never use.',
  facts: [
    'Glossary and Index (glossary-index plugin): every plugin, feature, screen, control, setting, command, asset and CLI tool, as an A–Z glossary, a categorized index and a grid.',
    'Window menu: floating windows, splits and tab groups; pull pages out and dock them back. Toolbars (TOOLBARS.md, lib-toolbars): docked and floating toolbars, a windows section with one button per open floating window. lib-workspace: panes, layouts, docked and floating toolbars.',
    'Assets menu: cycles, randomizes or resets every swappable part of the look.',
    'Staged: the UI directory as one floating window listing every page and settings screen with drag-out; creating a new toolbar or tab group by dragging commands and screens onto it; hiding and showing any element from the Assets menu.',
  ],
  chapters: [
    {
      id: 'find', title: 'Find anything',
      scenes: [
        { say: "Hi, I'm Amber. The console has a lot of screens. This video is about never getting lost in them, and making the console yours. Parts of it are a preview; I'll say which.", shot: 'Console Home; the Preview legend fades in.' },
        { say: "Start with the index. Every plugin, screen, setting, command and asset in the console, in an A to Z glossary, a categorized index like the back of a book, and a grid.", shot: 'Glossary and Index: switch between Glossary, Index and Grid.' },
        { staged: true, say: "The UI directory takes that and makes it a floating window you keep open. Every page and every settings screen, in one list. Click one to go there. This window is a preview.", shot: 'Staged: the UI directory floating over the console, labelled Preview; click a settings screen.' },
      ],
    },
    {
      id: 'windows', title: 'Pull pages out',
      scenes: [
        { say: "Any page can float. From the Window menu, pull the builds page out into its own window, put Crew beside it in a split, and group three pages into tabs.", shot: 'Window menu: float, split, tab group.' },
        { say: "Layouts are saved. Set up the builds page beside Crew once, and it opens that way next time.", shot: 'Reload; the split layout comes back as it was.' },
        { say: "Dock them back the same way. The toolbar keeps a button for each floating window, so nothing gets lost behind something else.", shot: 'Dock a window; the toolbar windows section.' },
      ],
    },
    {
      id: 'toolbar', title: 'Your own toolbar',
      scenes: [
        { staged: true, say: "Now build your own. On the orchestrator page, make a new floating toolbar, a preview here, and drag things onto it from the directory: the Queue, the agent cap setting, and the approve-next command.", shot: 'Staged: an empty floating toolbar; drag three items from the directory onto it.' },
        { staged: true, say: "Dock it under the title bar. It stays with that page, and it's yours. Do the same with a tab group: drag screens onto it, and they open as tabs.", shot: 'Staged: the toolbar docked; a custom tab group with three screens.' },
        { staged: true, say: "Toolbars you make follow you. They're saved with your look on axHub, so the same toolbar is waiting on the laptop at home and on the tablet at the office. Also a preview.", shot: 'The same custom toolbar on a second device.' },
        { say: "Every toolbar in the console is the same kind of thing underneath, with the same settings: icons or labels, spacing, and tap to confirm on touch screens.", shot: 'Toolbar settings: the per-toolbar choices.' },
      ],
    },
    {
      id: 'assets', title: 'The Assets menu',
      scenes: [
        { say: "Last, the Assets menu. Every part of the look is a swappable asset, and this menu cycles them, randomizes them, or puts them back.", shot: 'Assets menu open: cycle the nav style; randomize the toolbar; reset.' },
        { staged: true, say: "And hiding things. Never use the activity bar? Hide it from the Assets menu. Want it back? Show it. That part is a preview.", shot: 'Staged: hide and show the activity bar from the Assets menu.' },
        { say: "Want the default look back? Reset puts every swapped part back in one click, and your own toolbars stay where you put them.", shot: 'Assets menu: Reset; the custom toolbar still docked.' },
        { say: "Find any screen, put the tools you need where you need them, and hide the rest. Join the waitlist.", shot: 'End card.' },
      ],
    },
  ],
};
