// Step s19: a day with the AmberX Android app, filmed from the user's point of view (hands and phone screen).
export default {
  id: 'pov-day', step: 's19', kind: 'hero', title: 'A day with AmberX in your hand',
  app: 'amberx-droid', viewport: 'phone', skin: 'control-room',
  hook: 'No desk required. Your phone runs the whole show.',
  facts: [
    'Real in AmberX today: wake word and the command center, voice notes with a review card synced to axHub, held calls and approvals with countdowns, notifications, the console opened inside AmberX, the crew group chat, builds and their steps.',
    'Filming: point-of-view camera over the shoulder or chest-mounted, real screen recordings composited onto the phone, real data from the day of filming. Nothing on screen is mocked except the scenes marked staged.',
    'Staged: the user\'s own finished hero apps (time tracker, expense tracker) running on the phone; those are still previews.',
  ],
  chapters: [
    {
      id: 'morning', title: 'Morning',
      scenes: [
        { camera: 'story', say: "This is what AmberX looks like from the person holding it. Real phone, real screen, real data. The only previews are the two apps at the end, and I'll mark them.", shot: 'POV: a hand picks a phone up off a kitchen counter; coffee steam in the corner of frame.' },
        { say: "Seven thirty. The lock screen has one AmberX notification: a build landed overnight. Tap it, and there's the build card with every step ticked.", shot: 'POV screen: the notification; tap; the landed build with its steps.' },
        { say: "Amber X, note: ask the landlord about the parking spot. The review card shows it, I say save, and it's on axHub before the toast pops.", shot: 'POV: speaking toward the phone; the overlay; the review card; Save; the synced line.' },
      ],
    },
    {
      id: 'commute', title: 'On the move',
      scenes: [
        { say: "Amber X, what's on today? It reads back three tasks and a reminder I set by voice yesterday. Mark the first one done. Done.", shot: 'POV: the spoken question; the task list; a task ticked by voice.' },
        { camera: 'story', say: "On the bus, one earbud in.", shot: 'POV: bus window, the phone in one hand.' },
        { say: "A pop-up. A held call: deploy the waitlist page. Ninety seconds, then it runs by itself. I read the reason, and let it go.", shot: 'POV screen: the held call card with countdown; the reason; it runs.' },
        { say: "Another one wants a model raise for a hard step. That's mine to decide, so it waits for me. Approve.", shot: 'POV: an owner-only approval; a thumb taps Approve.' },
        { say: "A buzz from Ping Paulie: a systems check went red, he started the auto-fix, and two minutes later another buzz: green again. I didn't lift a finger.", shot: 'POV screen: the red-item notification, then the green-again one; the systems check list.' },
        { say: "Open the console right inside AmberX. The orchestrator: three building, two queued, eight slots on the server.", shot: 'POV screen: the console in AmberX on the orchestrator Queue.' },
      ],
    },
    {
      id: 'work', title: 'At lunch',
      scenes: [
        { say: "Lunch break. The crew's group chat. Brownie says QA passed on the gallery build, Lenny says it's in the merge queue. I send a thumbs up.", shot: 'POV screen: the Breakroom chat with real messages; a reaction.' },
        { say: "What's left on the video build? Gizmo reads it out: seven steps to go. I can hear it while I eat.", shot: 'POV: the phone propped against a cup; the spoken answer with the step list.' },
        { say: "Amber X, add a share button to the waitlist page. Patches answers in the chat: queued, about forty minutes. I go back to my sandwich.", shot: 'POV screen: the spoken request; Patches replies in the group chat with the build id.' },
        { say: "A notification: a screen needs review. Desktop and phone shots, side by side. Looks right. Approve.", shot: 'POV screen: UI Review item with two shots; Approve.' },
      ],
    },
    {
      id: 'evening', title: 'Evening',
      scenes: [
        { staged: true, say: "Home. Open the time tracker I built last week and stop the timer. These two apps of mine are previews for now.", shot: 'Staged POV: the time tracker on the home screen; stop the timer; the day total.' },
        { staged: true, say: "Snap the takeout receipt into the expense tracker. Food, twelve forty. Filed.", shot: 'Staged POV: the expense app camera; the entry with its category.' },
        { say: "Before bed, one more look at the queue. The share-button build is half done. Brownie's checking it. I don't need to do anything.", shot: 'POV screen: the build card at half its steps; the QA chip.' },
        { say: "Last thing. Amber X, what's waiting on me? Nothing. Good. Phone down.", shot: 'POV: the spoken question; the empty approvals list; the phone set face down on a nightstand.' },
        { say: "Your whole operation, in one hand, all day. Join the waitlist.", shot: 'End card.' },
      ],
    },
  ],
  short: {
    title: 'A day with AmberX in your hand (60 seconds)',
    scenes: [
      { say: "Seven thirty, still in the kitchen. A build landed overnight. One tap, and every step is ticked. Then a note by voice, synced to the hub before the toast even pops.", shot: 'POV: the notification, the build, a spoken note.' },
      { say: "On the bus, a held call counts down and runs. A model raise waits for me, because it's mine to decide. Approve.", shot: 'POV: held call; owner-only approval; Approve.' },
      { say: "At lunch, the crew's group chat: QA passed, it's in the merge queue. I ask for a share button, and Patches queues it. A screen needs review. Looks right. Approve.", shot: 'POV: the group chat; UI Review.' },
      { staged: true, say: "At home, stop the timer in my time tracker and snap a receipt into my expense app. Those two are previews.", shot: 'Staged POV: time tracker, expense app.' },
      { say: "What's waiting on me? Nothing. Phone down. Your whole operation in one hand. Join the waitlist.", shot: 'POV: the empty approvals list; end card.' },
    ],
  },
};
