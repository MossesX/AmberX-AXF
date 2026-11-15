// Hero video 2 (step s6): an expense tracker built by voice. Same format as the commute video.
export default {
  id: 'expenses', step: 's6', kind: 'hero', title: 'Say it, spend it, track it: an expense tracker by voice',
  app: 'amberx-droid', viewport: 'phone', skin: 'ledger',
  hook: 'Describe the money app you wish you had. Use it before lunch.',
  facts: [
    'The real Expenses app (apps/expenses, live at expenses.amberxai.com) has categories, monthly budgets with a budget-variance section in Statements, a category split with shares, top merchants, scan statement images (Claude vision, duplicate review), CSV/bank import, saved reports, and sign-in through the accounts module.',
    'It is a web app peeled from the studio; an Android build of it is not shipped, so the APK scenes are staged.',
    'Libraries named on screen are real catalog entries: lib-hubstore, lib-hubsync, lib-datagrid, lib-docstore, lib-lock, lib-notifications.',
    'Staged: the library matrix, voice-to-app assembly, the Android APK, a charts library.',
  ],
  chapters: [
    {
      id: 'need', title: 'Where did the money go',
      scenes: [
        { camera: 'story', say: "Riley opens the banking app at the end of the month and stares at it. Two hundred dollars of something. Coffee? Rideshares? No idea.", shot: 'Kitchen table, a bank app balance, a pile of paper receipts.' },
        { camera: 'story', say: "Every expense app Riley has tried wants a subscription, a bank login, and an hour of setup. So Riley picks up AmberX instead.", shot: 'Riley swipes past a paywall screen on a generic app, then opens AmberX.' },
        { say: "Hi, I'm Amber. Screens marked Preview are still being finished. The rest is real, and the expense app at the heart of this one is already live on the web.", shot: 'AmberX Home; the Preview legend fades in at the corner.' },
      ],
    },
    {
      id: 'describe', title: 'Say what you want',
      scenes: [
        { say: "Riley says it once. Track my expenses. Snap receipts, sort them into categories, set a monthly budget for each one, show me charts, and let me export it all for tax time.", shot: 'Voice overlay LISTENING with the live transcript.' },
        { say: "Plan Studio turns that into a plan: a ledger, receipt scanning, categories, budgets, a statements page, and export. It also notices the framework already has an expense app it can start from.", shot: 'Plan Studio: the expense tracker plan, with a note pointing at the existing Expenses app.', app: 'console-web' },
      ],
    },
    {
      id: 'matrix', title: 'Pick the features',
      scenes: [
        { staged: true, say: "Here's the library matrix, as a preview. Five features down the side: receipts, categories, budgets, charts, export. Pre-built AXF libraries across the top. Riley ticks all five.", shot: 'Staged library matrix: rows Receipts, Categories, Budgets, Charts, Export; ticks fill in.' },
        { staged: true, say: "Storage and sync come from the hub libraries, so the back end is done. Receipt photos go to the document store. The ledger is the data grid. Budget alerts ride on notifications. The app lock keeps it private.", shot: 'Ticks highlighted: lib-hubstore, lib-hubsync, lib-docstore, lib-datagrid, lib-notifications, lib-lock.' },
        { say: "Approve, and it's a build. The orchestrator breaks it into short steps, and the crew gets going.", shot: 'Approval card on the phone; tap Approve; the build in the orchestrator Queue.' },
      ],
    },
    {
      id: 'real', title: 'Already real',
      scenes: [
        { say: "Here's the expense app it's built on, running today. A ledger with categories, sorted and filtered, every column yours to hide or show.", shot: 'Expenses app: the ledger grid with categories; open the columns dialog.', app: 'expenses' },
        { say: "Scan a photo of a statement, and AI reads every line. Before anything is saved, you see what's new and what's already in the ledger, side by side, so nothing gets counted twice.", shot: 'Expenses: scan statement images; the review with duplicate pairs.', app: 'expenses' },
        { say: "Statements shows where it went: the split by category, the top merchants, and a budget variance for every category with a monthly budget. Over budget shows up in red.", shot: 'Expenses: Statements tab; the category split and the budget variance section.', app: 'expenses' },
        { say: "And a report freezes the month into one document you can save, print or send to your accountant.", shot: 'Expenses: create a report; it opens in its own tab.', app: 'expenses' },
      ],
    },
    {
      id: 'look', title: 'Its own look, from assets',
      scenes: [
        { say: "Every colour and font comes from tokens. Riley swaps the skin from Ledger to Atelier and the whole app follows, then saves it as the look for every money app to come.", shot: 'Skin swap ledger to atelier; save look as an asset.' },
      ],
    },
    {
      id: 'phone', title: 'On the phone',
      scenes: [
        { staged: true, say: "The finished Android app lands in axHub. Tap install, and it's on Riley's phone. The APK is a preview for now.", shot: 'Staged: axHub Apps with Expenses; Install; the Android install sheet.' },
        { staged: true, say: "Riley snaps the coffee receipt from this morning. Four fifty, Food and Drink, filed. The budget bar ticks up, still green.", shot: 'Staged: the phone camera on a receipt; the entry appears with its category; the budget bar moves.' },
        { staged: true, say: "A week of real sample spending later: groceries on budget, eating out a little over, and a chart that finally answers the question.", shot: 'Staged: the phone chart with sample expenses by category, one bar over its line.' },
        { camera: 'story', say: "Riley taps export, and the tax folder is done. In one evening.", shot: 'Riley closes the laptop lid, receipts pile now in the recycling.' },
        { say: "Your money app, the way you'd describe it. Join the waitlist and say what you need.", shot: 'End card: the pitch and the waitlist link.' },
      ],
    },
  ],
  short: {
    title: 'An expense tracker by voice (60 seconds)',
    scenes: [
      { camera: 'story', say: "End of the month. Riley stares at the bank app and has no idea where two hundred dollars went.", shot: 'A bank balance and a pile of receipts.' },
      { say: "So Riley tells AmberX, in plain English. Snap my receipts, sort them into categories, set budgets, show me charts, and let me export it for taxes.", shot: 'Voice overlay with the live transcript.' },
      { staged: true, say: "AmberX ticks pre-built libraries in the library matrix, a preview here, and a crew of agents assembles the app. No code.", shot: 'Staged matrix ticks; the build in the queue.' },
      { say: "It's built on a real expense app that's live today: a categorized ledger, AI receipt scanning, and budgets that turn red when you're over.", shot: 'Expenses ledger, scan review, budget variance.', app: 'expenses' },
      { staged: true, say: "Install the APK on the phone, a preview for now, snap this morning's coffee receipt, and watch the chart fill in with a week of real spending.", shot: 'Staged phone install, receipt, chart.' },
      { say: "Your money app, the way you'd describe it. Join the waitlist.", shot: 'End card.' },
    ],
  },
};
