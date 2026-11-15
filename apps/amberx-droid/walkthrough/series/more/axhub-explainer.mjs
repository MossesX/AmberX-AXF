// Step s7: the axHub explainer. Every app sends its settings, data and assets to axHub; that is what lets apps merge
// into one shell that shares one look. Ties into the commute (time tracker) and expenses hero videos.
export default {
  id: 'axhub-explainer', step: 's7', kind: 'deep', title: 'axHub: the one true source',
  app: 'axhub-web', viewport: 'desktop', skin: 'windows',
  hook: 'Why every app you build can share a look, a skin and its data, and even live in one shell.',
  facts: [
    'Real: lib-hubstore (settings and app data on axHub instead of the device), lib-hubsync (one look, settings and data for every app and device), lib-hubstatus (green only while settings come live from axHub), lib-docstore (this device plus the axHub data server); the shared appearance@1 document with the hub-wide skin; axHub hub projects and data folders (for example AmberX notes in hub-table@1 tables).',
    'Real shell: the studio hosts many modules in one shell, and Expenses is one of those modules peeled out into its own app (apps/expenses/README.md: npm run peel expenses --with accounts). One module, two homes: inside the shell or on its own.',
    'Staged: the time tracker app (from the commute video), the merged time tracker + expenses shell, and the live merge.',
  ],
  chapters: [
    {
      id: 'center', title: 'One true source',
      scenes: [
        { say: "Hi, I'm Amber. In the commute video, Jordan built a time tracker. In the expenses video, Riley built an expense tracker. Here's what they have in common, and why it matters. The two apps and the merge at the end are a preview; axHub itself is live.", shot: 'axHub web, Hub status; thumbnails of the two hero videos; the Preview legend.' },
        { say: "Every AmberX app sends three things to axHub: its settings, its data and its assets. Not a backup. The real copy. The app reads them back from the hub.", shot: 'Diagram: an app with three arrows into axHub labelled settings, data, assets.' },
        { say: "That's why the hub status badge only goes green when settings are coming live from the hub. If it's red, you know the app is running on what it last saw.", shot: 'An app\'s hub badge red, then green as it connects.' },
      ],
    },
    {
      id: 'store', title: 'How it stores them',
      scenes: [
        { say: "Inside axHub, each project has its own folder. Data lives in tables, settings in documents, files in the data server, with big files kept on the device when that makes more sense.", shot: 'axHub: a project folder; tables; a settings document; files.' },
        { say: "The look is one shared document: which skin, which tokens, which icons. Every app that follows the hub-wide skin reads the same one.", shot: 'The appearance document with the skin field highlighted.' },
        { say: "Change a setting on the phone, and the desktop has it before you've looked up. Same data, same look, every device.", shot: 'Phone and desktop: a setting changes on one, appears on the other.' },
      ],
    },
    {
      id: 'shell', title: 'Many apps, one shell',
      scenes: [
        { say: "Here's what that unlocks. Because every app keeps its parts on the hub and uses the same framework, apps can live together in one shell.", shot: 'Diagram: several app modules sliding into one shell frame.' },
        { say: "It already works this way. The expense tracker is a module from a larger shell, peeled out into its own app. Same code, two homes: on its own, or inside the shell beside other modules.", shot: 'The expense app on its own domain; then the same module inside the studio shell with other modules.', app: 'expenses' },
        { say: "Inside one shell, they share everything that makes an app feel like an app: the skin, the icons, the tokens, the menus, the sign-in.", shot: 'The shell\'s shared nav, title bar and sign-in highlighted.', app: 'expenses' },
      ],
    },
    {
      id: 'merge', title: 'The merge',
      scenes: [
        { staged: true, say: "Now the demo, as a preview. Jordan's time tracker and Riley's expense tracker, two separate apps. Say merge them into one shell.", shot: 'Staged: the two apps side by side; a voice command.' },
        { staged: true, say: "One window. Time on one tab, expenses on the other. The same nav, the same title bar, one sign-in. Each still reads its own data from the hub.", shot: 'Staged: the merged shell with two tabs.' },
        { staged: true, say: "And now they can talk. Billable hours from the time tracker show up as income in the expense ledger.", shot: 'Staged: an hours total appearing as an income line in the ledger.' },
        { staged: true, say: "Swap the skin. Both halves change at once, because they read the same look from the same hub. On the desktop, and on the phone.", shot: 'Staged: skin swap from Windows to Atelier on the merged shell, desktop and phone.' },
        { say: "One true source, so every app you build can share a look, share its data, and even share a home. Join the waitlist.", shot: 'End card.' },
      ],
    },
  ],
};
