// Step s21 (3 of 3): menus and toolbars, regenerated on their own, with settings per item.
export default {
  id: 'menus-toolbars', step: 's21', kind: 'deep', title: 'Every menu and toolbar, yours to reshape',
  app: 'console-web', viewport: 'desktop', skin: 'windows',
  hook: 'Regenerate any menu on its own, and tune any single item in it.',
  facts: [
    'Real: the Assets menu rolls or resets the look (assets.random, assets.reset); the theme manager rolls only the parts you tick; toolbars have per-toolbar choices (TOOLBARS.md, lib-toolbars); banner widgets have settings per widget and Reset to default; the context menu designer builds menus and reusable chunks, each with its own style, with a live preview.',
    'Staged: regenerating one toolbar, tab group or menu on its own, and a settings panel for every single item in a menu with per-item overrides shown against the default.',
  ],
  chapters: [
    {
      id: 'all', title: 'All of them',
      scenes: [
        { say: "Hi, I'm Amber. Every toolbar, tab group, nav menu, application menu and context menu in AmberX is built from assets, so every one can change. Some of what you'll see is live, and the per-menu and per-item parts are a preview.", shot: 'Console with a toolbar, tab group, nav, app menu and a context menu open, each outlined.' },
        { say: "The Assets menu can roll the whole look at once. Randomize, and every menu and toolbar changes together. Reset, and it's back.", shot: 'Assets menu: Randomize; everything changes; Reset.' },
      ],
    },
    {
      id: 'one', title: 'One at a time',
      scenes: [
        { staged: true, say: "Now just one. Right-click the main toolbar and pick Regenerate. Only that toolbar changes: new layout, new spacing, new icon style. Everything else stays put. This part is a preview.", shot: 'Staged: regenerate the main toolbar only.' },
        { staged: true, say: "Same for the tab group on the builds page, and the nav menu. Each one rolls on its own, so you can keep the ones you like and reroll the ones you don't.", shot: 'Staged: regenerate the tab group; then the nav.' },
        { staged: true, say: "Don't like the new one? Undo brings back the last version of just that menu. Pin one you love, and the next whole-look randomize leaves it alone.", shot: 'Staged: undo on one menu; pin a toolbar; randomize; the pinned toolbar stays.' },
        { say: "The theme manager does the same with fine control: tick only the toolbar parts in the token tree, lock the colours, and roll.", shot: 'Theme manager: tick toolbar tokens, lock colours, roll.' },
      ],
    },
    {
      id: 'items', title: 'Every item has settings',
      scenes: [
        { say: "Toolbars already have their own settings: icons or labels, spacing, tap to confirm on touch screens. The banner's widgets each have theirs: size, what it shows, priority, and Reset to default.", shot: 'Toolbar settings; a banner widget\'s settings with Reset to default.' },
        { staged: true, say: "Next, every single item gets its own settings. Open the Approve button in the toolbar, the Merge item in the context menu, and the Builds entry in the nav, three panels side by side, as a preview.", shot: 'Staged: three item settings panels open side by side.' },
        { staged: true, say: "Change the Approve button's label to Ship it, and its colour to the success token. The panel marks both as overrides, with the default shown right beside them.", shot: 'Staged: label and colour changed; override markers with the defaults.' },
        { staged: true, say: "Hide the Merge item from the context menu on phones only. Another override, scoped to phones.", shot: 'Staged: a hide-on-phone override on the Merge item.' },
        { staged: true, say: "Changed your mind? Reset on one field puts back just that field. Reset item puts back the whole item. Everything else you've changed stays.", shot: 'Staged: reset one field; then reset item.' },
      ],
    },
    {
      id: 'design', title: 'Design your own',
      scenes: [
        { say: "And if you want a menu from scratch, the context menu designer builds one: items, separators, and chunks you reuse across menus, each with its own style, in a live preview.", shot: 'Context menu designer: build a menu from chunks; the live preview updates.' },
        { say: "Every menu, every toolbar, every item, yours to reshape, and always one click from the default. Join the waitlist.", shot: 'End card.' },
      ],
    },
  ],
};
