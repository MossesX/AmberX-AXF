// Step s23 (1 of 4): the first five minutes, with a real clock on screen.
export default {
  id: 'first-five', step: 's23', kind: 'hero', title: 'Your first five minutes',
  app: 'amberx-droid', viewport: 'phone', skin: 'atelier',
  hook: 'Sign up to a running app in five minutes. The clock is on screen the whole time.',
  facts: [
    'Real today: AmberX install, connecting to an axHub, approvals, Plan Studio, the orchestrator, the android-compose template and the skins.',
    'Staged: public sign-up (AmberX is waitlist-only today), the guided first-app flow, and the finished first app on the phone. The on-screen clock is real and never cut; where a step is staged, the clock keeps running over the Preview label.',
  ],
  chapters: [
    {
      id: 'start', title: '0:00 Start the clock',
      scenes: [
        { say: "Hi, I'm Amber. That clock in the corner is real, and it never gets cut. Five minutes from sign-up to an app on your phone. Sign-up and the first-app guide are a preview, because right now AmberX is waitlist only.", shot: 'Phone with a large on-screen clock at 0:00; the Preview legend.' },
        { camera: 'story', say: "Meet Chris. Chris has never used AmberX. Coffee in one hand, phone in the other. Go.", shot: 'Chris on a couch; a thumb taps Start.' },
      ],
    },
    {
      id: 'signup', title: '0:10 Sign up and connect',
      scenes: [
        { staged: true, say: "Sign up with an email. A code arrives, Chris types it in. Thirty seconds gone.", shot: 'Staged: sign-up screen; the code; the clock at 0:40.' },
        { say: "Connect to a hub. That's the server that will hold Chris's apps, settings and data. One address, one token, and the status chip turns green.", shot: 'AmberX: hub address; connect; the axHub status chip green.' },
        { say: "Allow notifications, so approvals can reach the phone. Pick a look. Atelier. One minute ten.", shot: 'Notification permission; skin picker; the clock at 1:10.' },
      ],
    },
    {
      id: 'idea', title: '1:15 Say the first app',
      scenes: [
        { staged: true, say: "The first-app guide asks one question: what do you want to make? Chris says: a water tracker. Tap a glass each time I drink, a goal of eight a day, and a reminder if I'm behind at three.", shot: 'Staged: the guide; voice overlay with the transcript.' },
        { say: "Plan Studio writes the plan: one screen, one counter, a daily goal, a reminder. It finds that the framework already has storage, sync and notifications.", shot: 'Plan Studio: the water tracker plan; Have tags on three features.', app: 'console-web' },
        { say: "Approve. It's a build now, with short steps, and the crew starts on it. Two minutes in.", shot: 'Approve card; the build in the Queue; the clock at 2:05.' },
      ],
    },
    {
      id: 'wait', title: '2:05 While it builds',
      scenes: [
        { say: "Chris watches the crew work: the Android template, the libraries snapping in, the screen built from framework parts in the Atelier look.", shot: 'Crew live on the phone: steps ticking.' },
        { say: "Meanwhile, the plan shows exactly where it's at: three steps done, two to go, and how long each one is expected to take. No spinner with no explanation.", shot: 'Plan Studio on the phone: the steps ticking, each with its estimate.', app: 'console-web' },
        { say: "Chris changes their mind about one thing: make the goal ten glasses, not eight. Said out loud, the plan updates, and the step that hasn't run yet picks it up.", shot: 'A spoken change; the plan diff; the pending step updated.', app: 'console-web' },
        { staged: true, say: "One approval pops up: install the app on this phone. It says exactly what it will do. Approve.", shot: 'The approval card; Approve; the clock at 4:10.' },
      ],
    },
    {
      id: 'run', title: '4:20 Running',
      scenes: [
        { staged: true, say: "The app installs. Chris opens it. A big glass, a counter at zero, a goal of eight. Tap. One. This finished app is a preview of the flow we're building.", shot: 'Staged: the install; the water tracker running; a tap; the counter at 1.' },
        { say: "It's wearing the Atelier look Chris picked at the start, and it's already on axHub, so the next app Chris builds can see the water data if it's allowed to.", shot: 'The app in Atelier; axHub showing the new app and its data set.', app: 'axhub-web' },
        { say: "Four minutes thirty-two. Coffee's still warm. Join the waitlist and start your own clock.", shot: 'The clock stopped at 4:32; end card.' },
      ],
    },
  ],
  short: {
    title: 'Your first five minutes (60 seconds)',
    scenes: [
      { staged: true, say: "Real clock on screen, no cuts. Chris has never used AmberX before. Sign up, a preview for now, then connect to a hub and pick a look. One minute.", shot: 'Staged sign-up; the hub chip green; the clock at 1:00.' },
      { say: "Chris says the first app: a water tracker with a goal of eight glasses and a three o'clock reminder. Plan Studio writes the plan. Approve.", shot: 'Voice; the plan; Approve; the clock at 2:05.' },
      { say: "Halfway through, Chris changes the goal to ten glasses, out loud, and the plan picks it up before that step runs.", shot: 'A spoken change; the plan updates.', app: 'console-web' },
      { say: "The crew builds it on the Android template from pre-built libraries while Chris watches. One more approval to install.", shot: 'Crew live; the install approval; the clock at 4:10.' },
      { staged: true, say: "Open it, tap a glass, one. Four minutes thirty-two. The finished app is a preview. Join the waitlist and start your own clock.", shot: 'Staged: the running app; the clock at 4:32; end card.' },
    ],
  },
};
