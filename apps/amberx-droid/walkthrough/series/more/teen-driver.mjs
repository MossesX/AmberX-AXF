// Hero video 6 (step s11): teen driver safety. Family safety, not secret tracking: the app is visible on the teen's
// phone, he knows it's on, and he sees exactly what his parents see.
export default {
  id: 'teen-driver', step: 's11', kind: 'hero', title: 'New driver in the family',
  app: 'amberx-droid', viewport: 'phone', skin: 'clinic',
  hook: 'A driving safety app for your family, built by talking, in minutes.',
  facts: [
    'Real today: lib-notifications (channels, private lock-screen alerts), lib-work (background jobs that survive a restart), lib-hubsync and lib-hubstore (shared family data on axHub), axHub approvals, the orchestrator and Crew.',
    'Staged: location, motion and maps libraries, trip tracking, phone-use-while-moving detection, speed alerts, geofences, the finished app on both phones, voice-to-app assembly, the library matrix.',
    'Phone-use detection is described as "the phone being unlocked and typed on while the car is moving", which is what an app can see; it does not read messages.',
  ],
  chapters: [
    {
      id: 'licence', title: 'The licence',
      scenes: [
        { camera: 'story', say: "Sam passed the driving test this morning. Sam's parents are thrilled, and also, quietly, terrified.", shot: 'A teen holding up a new licence in the kitchen; the parents hugging him, exchanging a look over his shoulder.' },
        { camera: 'story', say: "That night, they sit down together. Not to spy. To agree on a few rules, and an app that helps everyone keep them.", shot: 'Kitchen table, parents and Sam, a phone in the middle.' },
        { say: "Hi, I'm Amber. The driving features in this video are a preview of what AmberX assembles. The notifications, the sync and the build pipeline are real today.", shot: 'AmberX Home; the Preview legend fades in.' },
      ],
    },
    {
      id: 'describe', title: 'Say the rules',
      scenes: [
        { say: "Mom says it out loud. Build a driving safety app for Sam. Track trips. Alert us if his phone's being used for texting while the car is moving. Alert us if he goes over a speed we set. Tell us when he gets to school or leaves practice.", shot: 'Voice overlay LISTENING; the transcript fills in.' },
        { say: "Plan Studio writes it up, and adds one line on its own: the app is visible on Sam's phone, with a clear on indicator, and he sees the same rules his parents do.", shot: 'Plan Studio plan card; the transparency line highlighted.', app: 'console-web' },
        { staged: true, say: "The library matrix, a preview here, ticks the pieces. Location and motion for trips and speed. Maps. Geofences. Notifications to the parents' phones. Family data shared on axHub.", shot: 'Staged library matrix: rows Trips, Phone use, Speed, Places, Alerts; columns location, motion, maps, notifications, hubsync.' },
      ],
    },
    {
      id: 'assemble', title: 'Assembled, not coded',
      scenes: [
        { say: "Approve the build, and the crew assembles it from pre-built AXF libraries. No code. You can watch it in Crew, and approve anything that touches the family's server.", shot: 'Approval card; the build in the orchestrator queue; Crew live.' },
        { say: "Alerts go out through the real notification library, with private lock-screen alerts, so a speed warning doesn't show the details to anyone glancing at the phone.", shot: 'Notification settings: channels and the private lock-screen option.', app: 'console-web' },
        { staged: true, say: "Mom sets the limit to sixty-five on the highway. Dad adds three places: home, school, and the ball field.", shot: 'Staged: the speed limit slider; a map with three geofence circles.' },
      ],
    },
    {
      id: 'sam', title: "Sam's side",
      scenes: [
        { staged: true, say: "On Sam's phone, the app sits right there on the home screen, with a Driving safety is on badge. He opens it and sees the rules: the speed limit, the three places, the phone-while-moving alert. No secrets.", shot: "Staged: the teen's phone with the app icon and the On badge; the rules screen." },
        { staged: true, say: "And there's a button just for him: Home safe. One tap when he gets in, and his parents stop wondering.", shot: 'Staged: the Home safe button, a check animation.' },
      ],
    },
    {
      id: 'drive', title: 'The first drive alone',
      scenes: [
        { camera: 'story', say: "Saturday. Sam's first solo drive, to practice.", shot: 'Car backing out of the driveway; a parent watching from the window.' },
        { staged: true, say: "Dad's phone: Sam arrived at the ball field. Two hours later: Sam left the ball field. The trip shows up on the map, start to finish.", shot: "Staged: the parent's notifications; the trip line on the map." },
        { staged: true, say: "On the highway home, sixty-nine in a sixty-five. One alert to the parents. Sam sees it too, and eases off.", shot: 'Staged: a speed alert on both phones.' },
        { staged: true, say: "In the driveway: Home safe. Mom smiles and puts the phone down.", shot: 'Staged: the Home safe notification on the parent phone.' },
        { say: "It connects to the family's other apps through axHub too, so the family calendar already knows practice ends at five. Built by talking, in minutes. Join the waitlist.", shot: 'axHub: the family project with the driving app next to the calendar; end card.', app: 'axhub-web' },
      ],
    },
  ],
  short: {
    title: 'New driver in the family (60 seconds)',
    scenes: [
      { camera: 'story', say: "Sam just got his licence this morning. His parents are proud, and also, quietly, a little terrified.", shot: 'The licence, the parents\' look.' },
      { say: "So they say it to AmberX: track trips, alert us about texting while the car is moving, warn us over a speed we set, and tell us when he gets to school.", shot: 'Voice overlay and transcript.' },
      { staged: true, say: "AmberX assembles it from pre-built libraries, location, motion, maps and notifications. No code. The driving parts are a preview.", shot: 'Staged matrix ticks; the build in the queue.' },
      { staged: true, say: "On Sam's phone, the app is right there, and it says it's on. He sees the same rules, and gets a Home safe button.", shot: "Staged: the teen's phone with the On badge and Home safe." },
      { staged: true, say: "Saturday, his first solo drive. Arrived at practice. Left practice. A little fast on the highway, so one alert, and he eases off. Then: home safe. Family safety, not secret tracking. Join the waitlist.", shot: 'Staged: the parent notifications; end card.' },
    ],
  },
};
