// Deep dive (step s15): skins in depth, then enterprise branding.
export default {
  id: 'skins-branding', step: 's15', kind: 'deep', title: 'Skins and enterprise branding, in depth',
  app: 'console-web', viewport: 'desktop', skin: 'atelier',
  hook: 'Built on tokens from the ground up, so one click can make it a different company\'s app.',
  facts: [
    'Tokens: 220 distinct --fx-* design tokens; 54 asset types in framework/assets; 6 skins (atelier, clinic, control-room, ledger, newsroom, windows). check-theme and check-controls fail CI on any literal colour or size.',
    'Skin scopes (APPEARANCE-SOURCE.md, the icon-map model): plugin → view → app → global, first non-inherit level decides; the global skin lives in the shared appearance@1 document on axHub; apps follow it while "Follow the hub-wide skin" is on.',
    'Theme manager: rolls colour themes or every part a skin leaves open (style, layout, behaviour) with a tri-state token tree, locks, presets, contrast-checked palettes, live preview, undo/redo, save as asset@1. Theme editor: token-by-token, live preview through the hub look.',
    'Brand library: 250 logos, 250 animated logos, 100 icon packs and 50 branding packages; apply a package as the brand, or a logo, animated logo or icon pack into the active brand.',
    'Staged: the AI skin generator, the sandbox skin editor with snapshot history and revert, the Enterprise Branding Studio screen and the one-map-for-every-brand-slot view.',
  ],
  chapters: [
    {
      id: 'why', title: 'Why tokens all the way down',
      scenes: [
        { say: "Hi, I'm Amber. This one goes deep. Most of it is live; the AI skin maker, the sandbox editor and the branding studio are a preview. First, why skins work here when they break everywhere else.", shot: 'Console Home in Atelier; the Preview legend fades in.' },
        { say: "Every colour, size, space, font, corner and border in AmberX comes from a token. Two hundred and twenty of them. Not mostly. Every one. A build that slips in a raw colour fails its checks and never lands.", shot: 'The token registry: categories expanding; then a CI check failing on a literal colour.' },
        { say: "Because nothing is hard-wired, a skin can change more than colours. Behaviour, placement and layout are tokens too. Watch the nav move from the side to the top, the buttons round off, and menus open on hover instead of click.", shot: 'Live: a skin change moves the nav, rounds controls, changes menu behaviour.' },
      ],
    },
    {
      id: 'config', title: 'Pick what changes',
      scenes: [
        { say: "The theme manager lets you choose exactly what a roll may touch. A tree of every token, with ticks and locks. Leave layout alone, change style and colour, lock the brand red.", shot: 'Theme manager: the token tree; untick layout, tick style and colour, lock one colour.' },
        { say: "Roll. The palette stays readable because every combination is contrast-checked. Don't like it? Undo. Roll again.", shot: 'Roll; the console repaints; undo; roll again.' },
        { staged: true, say: "Or ask for one. Make me a skin that feels like a calm medical clinic at night. The AI skin maker, a preview here, writes the tokens, and they open in the sandbox editor, away from your real apps.", shot: 'Staged: the prompt; the generated skin opening in a sandbox editor labelled Preview.' },
        { staged: true, say: "Save it as a new skin. Every save is a snapshot, so you can scroll back through its history and revert to any earlier version.", shot: 'Staged: save as skin; the snapshot history list; revert.' },
      ],
    },
    {
      id: 'apply', title: 'Every app at once',
      scenes: [
        { say: "Apply it hub-wide. The skin goes into the shared look on axHub, and every app that follows the hub skin changes at once. Console, axHub, desktop and phone.", shot: 'Apply as the hub-wide skin; the console, axHub web and the phone repaint together.' },
        { say: "And it's scoped. One plugin can keep its own skin, one view another, and the rest follow the app. The nearest setting wins.", shot: 'Settings → Appearance: scopes with one plugin overriding.' },
      ],
    },
    {
      id: 'brand', title: 'Enterprise branding',
      scenes: [
        { say: "Part two: brands. The brand library ships two hundred and fifty logos, two hundred and fifty animated logos, a hundred icon packs and fifty full branding packages.", shot: 'Brand library: the four tabs with counts; filter by style.' },
        { say: "Preview any piece in light and dark, at every size. Animated logos play on a transparent background, so they sit cleanly on any header.", shot: 'Preview an animated logo over light and dark headers.' },
        { staged: true, say: "The Enterprise Branding Studio, a preview, puts every brand slot in the project on one map: each icon, badge, logo, banner and splash, with what fills it now.", shot: 'Staged: the branding studio map, a grid of slots with their current assets.' },
        { say: "An icon pack acts through that map. Swap it, and every icon in every view changes at once, because each one points at a slot, not a file.", shot: 'Apply a different icon pack; the nav and toolbars change.' },
        { say: "Now one click on a branding package. Logos, animated logos, banners and marks land everywhere: title bars, headers, nav, the splash screen.", shot: 'Apply a branding package; the whole console rebrands.' },
        { say: "Same app, side by side, under two brands. You'd never guess they were the same product. That's what building on tokens buys you. Join the waitlist.", shot: 'Split screen: the same app under two branding packages; end card.' },
      ],
    },
  ],
};
