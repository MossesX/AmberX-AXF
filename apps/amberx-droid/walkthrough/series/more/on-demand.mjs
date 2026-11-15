// Hero video 5 (step s10): "an app whenever you need one", told over days and weeks.
// Safety: the teen's apps are friends-only, with no public profiles and no location. Location sharing appears only in
// the adults' festival scene, and only after each person opts in.
export default {
  id: 'on-demand', step: 's10', kind: 'hero', title: 'An app whenever you need one',
  app: 'amberx-droid', viewport: 'phone', skin: 'newsroom',
  hook: 'Unlimited apps, in minutes, that all fit together.',
  facts: [
    'axHub sync is real: lib-hubsync and lib-hubstore keep settings, data and the look on axHub for every app and device.',
    'The skin swap is real: six skins in framework/assets/skin (atelier, clinic, control-room, ledger, newsroom, windows), and every connected app follows a swap.',
    'Notifications (lib-notifications) and background work (lib-work) are real Android libraries; direct messages are the real accounts-module messenger.',
    'Staged: the four story apps themselves, voice-to-app assembly, the picture board, alarms built from a sentence, group location sharing.',
  ],
  chapters: [
    {
      id: 'day1', title: 'Monday: a chat',
      scenes: [
        { say: "Hi, I'm Amber. This one's told over a few weeks. The apps in it are a preview of what AmberX assembles; the sync, the approvals and the skins underneath are real.", shot: 'AmberX Home; the Preview legend fades in; a calendar card reads Week 1.' },
        { camera: 'story', say: "Meet Eli. Sixteen, always in a hurry. Monday, Eli and his best friend Theo want their own place to talk about their game mod, not a giant public app.", shot: 'Two teens on a school bench, one phone between them.' },
        { staged: true, say: "Amber, make me a chat for me and Theo. Friends only. A minute later, it's on both phones. Invite-only, no public profile, no location, nothing searchable.", shot: 'Staged: voice overlay; the chat app opens with two members and a Friends only badge.' },
      ],
    },
    {
      id: 'week1', title: 'Thursday: a picture board',
      scenes: [
        { camera: 'story', say: "Thursday. The friend group has a hundred memes and nowhere to keep them.", shot: 'Five teens laughing at a phone at lunch.' },
        { staged: true, say: "Amber, add a picture board for my friends, with a message board. Done. It already knows who his friends are, because the chat app shared them through axHub.", shot: 'Staged: the picture board grid; the member list appears pre-filled; a link line to the chat app.' },
        { say: "That's the trick. Every app Eli builds sends its data, settings and look to axHub, his own hub. So the next app starts with everything the last one knew.", shot: 'axHub view: Eli\'s project with two apps and the shared data sets.', app: 'axhub-web' },
      ],
    },
    {
      id: 'week3', title: 'Week three: out the door',
      scenes: [
        { camera: 'story', say: "Week three. Eli's halfway out the door, cleats in one hand, when the coach texts the new practice times. Oh, I need this.", shot: 'Front door, one shoe on, phone buzzing with a schedule text.' },
        { staged: true, say: "Amber, make a baseball practice schedule with alarms. Remind me an hour before, and again when it's time to leave. By the time he's at the corner, it's done.", shot: 'Staged: voice overlay on the sidewalk; the schedule app with three practices and two alarms each.' },
        { staged: true, say: "And it plugs right in. The team chat gets a card when practice moves. No setup, no waiting. Every app you build from now on connects automatically.", shot: 'Staged: a practice-moved card arriving in the chat app.' },
        { say: "The reminders ride on the real notification and background libraries, so they fire even when the phone's been asleep in a gym bag.", shot: 'Library list: lib-notifications and lib-work highlighted.', app: 'console-web' },
      ],
    },
    {
      id: 'festival', title: 'A few years on: the festival',
      scenes: [
        { camera: 'story', say: "Fast forward a few years. Eli and five friends, all grown up, in a parking lot before a music festival. Somebody says, we'll want to keep track of each other in there.", shot: 'Six young adults by a car, wristbands on, the festival gates behind them.' },
        { staged: true, say: "Amber, make a group app for the six of us, with group messages and location sharing. It asks each person, on their own phone: share your location with this group until midnight? Everyone taps yes.", shot: 'Staged: the group app; six phones each showing the consent prompt with Share until midnight and No thanks.' },
        { staged: true, say: "Inside, a map of six dots, a group thread, and a meet-up pin by the main stage. At midnight, sharing switches itself off.", shot: 'Staged: the festival map with six opted-in dots; the group thread; a midnight timer chip.' },
      ],
    },
    {
      id: 'skin', title: 'One click, a different world',
      scenes: [
        { say: "Here's the part that still gets people. All of Eli's apps share one look, because every colour, font and corner comes from tokens.", shot: 'The apps side by side on phones in the newsroom skin.' },
        { say: "One click on a different skin, and every connected app changes at once. Same apps, completely different look.", shot: 'Skin switch to control-room; every app on every screen follows together.' },
        { say: "Unlimited apps, on demand, in minutes. No code, just assembly. They all fit, and every app you build from now on connects automatically. Join the waitlist.", shot: 'End card: the pitch and the waitlist link.' },
      ],
    },
  ],
  short: {
    title: 'An app whenever you need one (60 seconds)',
    scenes: [
      { staged: true, say: "Monday, Eli wants a chat for him and his best friend. Friends only. One sentence, and it's on both phones. These apps are a preview of what AmberX assembles.", shot: 'Staged: the two-person chat.' },
      { staged: true, say: "Thursday, a picture board and message board for the friend group. It already knows his friends, because every app shares through axHub.", shot: 'Staged: the picture board with the member list pre-filled.' },
      { staged: true, say: "Week three, halfway out the door: a practice schedule with alarms. Done by the corner, already linked to the team chat.", shot: 'Staged: the schedule app; the card in the chat.' },
      { staged: true, say: "Years later, a festival: a group app where all six friends opt in to share their location until midnight.", shot: 'Staged: consent prompts; the map with six dots.' },
      { say: "Then one click on a new skin, and every connected app looks brand new. Every app you build from now on connects automatically. Join the waitlist.", shot: 'Skin swap across all apps; end card.' },
    ],
  },
};
