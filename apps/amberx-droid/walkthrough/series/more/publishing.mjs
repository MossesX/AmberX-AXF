// Step s23 (4 of 4): publishing, from built to live: Android APK and Play Store, and a web app on your own domain via Coolify.
export default {
  id: 'publishing', step: 's23', kind: 'deep', title: 'From built to live',
  app: 'console-web', viewport: 'desktop', skin: 'windows',
  hook: 'An APK on your phone, a Play Store listing, and a web app on your own domain.',
  facts: [
    'Real: the android-compose template builds an APK (./gradlew :app:assembleDebug); the Expenses web app is live on its own domain (expenses.amberxai.com) as a container on the VPS, deployed through Coolify behind Traefik; the deploy kit lives in framework/deploy.',
    'Staged: the in-console Publish screen, signing a release build from the console, the Play Store submission flow, and pointing a new custom domain from the console.',
  ],
  chapters: [
    {
      id: 'intro', title: 'Two ways out',
      scenes: [
        { say: "Hi, I'm Amber. Your app is built. Now it has to go somewhere people can use it. Two roads: an Android app, and a web app on your own domain. The build and the server are real; the one-click publish screens are a preview.", shot: 'A finished build in Landed; the Preview legend.' },
      ],
    },
    {
      id: 'apk', title: 'Android',
      scenes: [
        { say: "Every Android app starts from the same template, so every one builds the same way. One command makes the APK. Here it is, built from the real template.", shot: 'Terminal: the gradle assemble command; the APK file appearing.' },
        { say: "Send it to your own phone through axHub, tap install, and it's running. That's how you test it with the people around you.", shot: 'The APK on the phone; install; the app running.', app: 'amberx-droid' },
        { staged: true, say: "Updates work the same way, and the update prompt is a preview. Change the app, the build lands, a new APK is made, and every phone that installed it through axHub sees there's an update.", shot: 'axHub Apps: the app with a new version; Update on the phone.', app: 'amberx-droid' },
        { staged: true, say: "For the Play Store, the Publish screen, a preview here, makes a signed release build. Your signing key stays on your server, never in the code.", shot: 'Staged: Publish → Android; Build signed release; the key stored on the server.' },
        { staged: true, say: "It fills in the store listing from what it already knows: the name, the description from the plan, screenshots from UI Review in phone sizes, and the privacy notes for every permission the libraries use.", shot: 'Staged: the listing form pre-filled; screenshots; the data safety answers.' },
        { staged: true, say: "Review it, submit it to Google Play, and the status shows up on the build until it's approved.", shot: 'Staged: Submit; the status chip In review on the build card.' },
      ],
    },
    {
      id: 'web', title: 'The web',
      scenes: [
        { say: "The web app goes to your own server. Here's one that's live right now: the expense tracker, on its own domain.", shot: 'Browser: expenses.amberxai.com live.' },
        { say: "It runs as a container, managed by Coolify, the deploy tool on the server. Traefik sits in front and sends your domain to the right container, with HTTPS.", shot: 'Coolify: the expenses app container; its domain and certificate.' },
        { say: "A new version lands on main, and Coolify rolls it out. The old container keeps serving until the new one is healthy.", shot: 'Coolify deploy log: build, health check, switch.' },
        { say: "Your data never leaves your server. The database and the files sit in volumes next to the container, and Coolify can back them up on a schedule. If a client ever asks where their data lives, you can name the machine.", shot: 'Coolify: the app volumes; the backup job history.' },
        { staged: true, say: "From the console, the Publish screen, also a preview, takes your domain, tells you the one DNS record to add, and checks it until it's live.", shot: 'Staged: Publish → Web; enter a domain; the DNS record; a green check.' },
      ],
    },
    {
      id: 'close', title: 'Live',
      scenes: [
        { say: "An APK in your pocket, a store listing on the way, and a web app on your own domain, on your own server. Join the waitlist.", shot: 'Phone and browser side by side; end card.' },
      ],
    },
  ],
  short: {
    title: 'From built to live (60 seconds)',
    scenes: [
      { say: "Your app is built. Now ship it. Every Android app comes from the same template, so one command makes the APK, and axHub sends it to your phone.", shot: 'The gradle command; the APK; install on the phone.' },
      { staged: true, say: "For Google Play, the Publish screen, a preview, makes a signed release, fills in the listing from the plan and UI Review, and submits it.", shot: 'Staged: signed release; listing; Submit.' },
      { say: "For the web, your app runs as a container on your own server, deployed by Coolify, on your own domain with HTTPS. Like this expense tracker, live today.", shot: 'expenses.amberxai.com; Coolify.' },
      { say: "The data sits right next to it, on your server, in your volumes, backed up on a schedule. Nobody else holds a copy.", shot: 'Coolify volumes; backup history.' },
      { say: "New version on main? Coolify rolls it out without downtime. Join the waitlist.", shot: 'Deploy log; end card.' },
    ],
  },
};
