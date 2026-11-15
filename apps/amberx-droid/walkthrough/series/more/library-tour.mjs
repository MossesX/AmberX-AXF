// Step s23 (3 of 4): a tour of the pre-built AXF libraries, front end and back end, with a quick example of each group.
export default {
  id: 'library-tour', step: 's23', kind: 'deep', title: 'The library tour',
  app: 'console-web', viewport: 'desktop', skin: 'control-room',
  hook: 'Every pre-built piece you can snap together, in three minutes.',
  facts: [
    'framework/catalog/libraries.json lists 23 libraries (Nov 15 2026): Android lib-browser, lib-hub, lib-lock, lib-mcp, lib-notifications, lib-voice, lib-work; web lib-apiclient, lib-approvals, lib-ashes, lib-claude-session, lib-datagrid, lib-dnd, lib-docstore, lib-hubstatus, lib-hubstore, lib-hubsync, lib-listeners, lib-plugintheme, lib-recorder, lib-toolbars, lib-tree, lib-workspace.',
    'Android also has framework modules (axf-kernel, axf-ui, axf-data, axf-network, axf-nav and others) and library modules not yet in the catalog (lib-accounts, lib-admin, lib-billing, lib-logging, lib-profile, lib-settings). The tour counts only the 23 catalog entries.',
    'Staged: the library matrix view. The libraries themselves and their examples are real.',
  ],
  chapters: [
    {
      id: 'intro', title: 'What snaps together',
      scenes: [
        { say: "Hi, I'm Amber. These are the pre-built libraries every AmberX app is assembled from. Twenty-three in the catalog today, every one real. The matrix view that shows them all against your features is a preview.", shot: 'The library catalog; the Preview legend.' },
        { staged: true, say: "Here's that matrix: features down the side, libraries across the top. Tick what you need. Let's walk through them in groups, with a quick example of each.", shot: 'Staged: the library matrix with the 23 columns.' },
      ],
    },
    {
      id: 'backend', title: 'Data and the hub',
      scenes: [
        { say: "The back end first. Hub storage keeps an app's settings and data on axHub instead of the device. Hub sync gives every app and device one look, one set of settings, one set of data. The document store handles files, with big ones kept on the device.", shot: 'An app saving a setting; it appears on a second device; a file in the document store.' },
        { say: "The hub status badge stays green only while settings are really coming live from axHub, so you always know you're connected. The hub connector gives an Android app the approvals feed and the hub address.", shot: 'The status badge red, then green; the approvals feed in an Android app.' },
        { say: "The API client is the one way every web app talks to a server: tokens, calls, streams, clear errors. Harvested from nine copies in the console.", shot: 'A call through the API client; an error shown cleanly.' },
      ],
    },
    {
      id: 'ui', title: 'Screens and controls',
      scenes: [
        { say: "Front end. The data grid: categorized sub-grids, hideable columns, expandable rows. The tree view: an outline with search, filters and drag and drop. Drag and drop itself works with mouse and touch, with a trash can that pops up when you need it.", shot: 'Data grid; tree view; drag an item to the pop-up trash can.' },
        { say: "Workspace gives you panes, layouts, and docked or floating toolbars. Toolbars gives every toolbar tap-to-confirm on touch screens and its own settings. Plugin theme lets one plugin wear its own tokens over the app's theme.", shot: 'Workspace panes; a toolbar confirm on touch; a plugin with its own colours.' },
        { say: "The library browser shows any set of items in two panes with multi-select and compare. Approvals puts a badge for axHub approvals and held calls in any title bar.", shot: 'Library browser compare; the approvals badge in a title bar.' },
      ],
    },
    {
      id: 'device', title: 'Device and voice',
      scenes: [
        { say: "On Android: notifications with channels and private lock-screen alerts. Background work that keeps running and restarts after a reboot. App lock with fingerprint, face or PIN. And voice: speech in, prompts out, voice commands.", shot: 'A private lock-screen alert; the app lock prompt; a voice command.' },
        { say: "MCP connects an app to MCP servers. Listeners are the rules behind AmberX's background listeners. The recorder captures the screen with mouse and keys and cues.", shot: 'An MCP server connected; a listener rule; a screen recording with cursor replay.' },
      ],
    },
    {
      id: 'tools', title: 'Builder tools',
      scenes: [
        { say: "And two for builders. AshesUI is a live element inspector: point at anything and see its tokens. Claude session is the shared piece behind the terminal and the companion.", shot: 'AshesUI inspecting a button; a Claude session tab.' },
        { say: "Twenty-three libraries, front end and back end, and more harvested every time something new gets built. Join the waitlist.", shot: 'The catalog list; end card.' },
      ],
    },
  ],
  short: {
    title: 'The library tour (60 seconds)',
    scenes: [
      { say: "Every AmberX app is snapped together from pre-built libraries. Twenty-three in the catalog today.", shot: 'The catalog list.' },
      { say: "Back end: hub storage and sync, so every app and device shares one set of settings and data. A document store for files. One API client for every server call.", shot: 'Sync across two devices; a file stored.' },
      { say: "Front end: a data grid, a tree view, drag and drop, workspaces and toolbars.", shot: 'Grid; tree; drag to trash; toolbars.' },
      { say: "On the phone: notifications, background work, app lock, voice and MCP.", shot: 'Lock-screen alert; app lock; a voice command.' },
      { say: "And every one of them was harvested from real work: the data grid, the toolbars and the API client all ran the console before they ran your app.", shot: 'The libraries README harvest notes.' },
      { staged: true, say: "Tick what you need in the library matrix, a preview here, and AmberX assembles it. Join the waitlist.", shot: 'Staged: the matrix with ticks; end card.' },
    ],
  },
};
