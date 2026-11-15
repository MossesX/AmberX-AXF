// Hero video 3 (step s8): "the boss texts". A gallery app ordered from bed, built overnight by the crew.
export default {
  id: 'boss-texts', step: 's8', kind: 'hero', title: 'The boss texts at 11 PM',
  app: 'amberx-droid', viewport: 'phone', skin: 'control-room',
  hook: 'Order an app from bed. Wake up to it.',
  facts: [
    'The crew and their jobs are real (naming notes, crew-live and agent-swarm plugins): Patches runs the build floor, Polo is the all-round builder, Brownie is QA, Ashes is security, Landin\' Lenny lands code through the merge queue, Marco signs off on what ships, Jennifer runs the Breakroom banter.',
    'The Breakroom group chat is real (agent-swarm, "Open group chat" in Crew). The overnight conversation in this video is scripted, so those scenes are staged.',
    'axHub approval pop-ups with a countdown are real. Owner-only calls stay with the owner: the crew never approves them.',
    'Sign-in comes from the accounts module (apps/expenses ships it). Staged: photo upload with GPS tags, the map, the public gallery, voice-to-app assembly.',
  ],
  chapters: [
    {
      id: 'text', title: 'The text',
      scenes: [
        { camera: 'story', say: "Eleven at night. Tyler's in bed, half asleep, when the phone buzzes. It's the boss.", shot: 'Dark bedroom, phone lights up on the nightstand.' },
        { camera: 'story', say: "We're having an event tomorrow. I need a public image gallery up right now for all the employees to share their pictures.", shot: 'Close on the text message bubble; Tyler groans into the pillow.' },
        { say: "Hey, I'm Amber. Anything with a Preview label is still in the works. The approvals and the crew you're about to meet are real.", shot: 'AmberX opens in night mode; the Preview legend fades in.' },
      ],
    },
    {
      id: 'order', title: 'Order from bed',
      scenes: [
        { say: "Tyler doesn't even sit up. Amber, build me a gallery with user accounts and GPS tagging.", shot: 'Voice overlay LISTENING; the transcript line fills in.' },
        { say: "Plan Studio writes the plan: a login gate, photo uploads, a map of where each photo was taken, and a public gallery page. Location is opt-in, with a consent prompt the first time.", shot: 'Plan Studio plan card on the phone: four features, the consent note highlighted.', app: 'console-web' },
        { say: "Two approval pop-ups. Start the build, and deploy to the company's server when it passes review. Tyler taps approve, approve.", shot: 'Two axHub approval cards with countdowns; tap Approve on each.' },
        { camera: 'story', say: "All right, I'm going to sleep now. Get that done, I need it in the morning. Phone on the nightstand. Lights out.", shot: 'Tyler puts the phone face down and rolls over. The room goes dark.' },
      ],
    },
    {
      id: 'night', title: 'The night shift',
      scenes: [
        { say: "Meet the crew. Patches runs the build floor. Polo builds. Brownie checks. Ashes guards the keys. And Jennifer keeps everybody's spirits up.", shot: 'Crew view: the agent cards with avatars and their roles.', app: 'console-web' },
        { staged: true, say: "Patches posts in the group chat. New order, gallery for an event, owner's asleep, needs it by morning. Polo, you've got accounts and uploads.", shot: 'Staged Breakroom group chat, a preview: Patches posts the order; the build card is attached.', app: 'console-web' },
        { staged: true, say: "Polo: on it. This guy's asleep and we're up all night working. Jennifer: I made coffee. Virtual coffee. It's the thought that counts.", shot: 'Staged chat: messages with avatars; a coffee emoji reaction.', app: 'console-web' },
        { staged: true, say: "Ashes: before anybody ships a map, location stays off until each person says yes. Consent prompt, plain words, a clear no button. Polo: done, here you go, finish that.", shot: 'Staged chat: Ashes flags location consent; Polo hands off with a commit link.', app: 'console-web' },
        { staged: true, say: "Brownie runs the checks at three in the morning. Login works, uploads work, the map pins land where the photos were taken. Brownie: green. Somebody wake Lenny.", shot: 'Staged chat: Brownie posts a checklist, all ticks green.', app: 'console-web' },
        { say: "Landin' Lenny takes it through the merge queue, and Marco signs off on the deploy Tyler already approved. Nothing the owner has to decide gets decided for him.", shot: 'Orchestrator: the build moving to Landed; the merge queue banner.', app: 'console-web' },
        { camera: 'story', say: "Time-lapse. The moon crosses the window. The sky goes blue, then gold.", shot: 'Window time-lapse, night to sunrise; the phone screen lights now and then on the nightstand.' },
      ],
    },
    {
      id: 'morning', title: 'Good morning',
      scenes: [
        { camera: 'story', say: "Seven AM. Tyler yawns, rolls over, and picks up the phone.", shot: 'Tyler stretches, grabs the phone.' },
        { staged: true, say: "Boom. The app is ready. A login page for employees. Upload a picture, and the first time, it asks: share where this was taken? Tyler taps Allow.", shot: 'Staged: login gate; upload; the location consent prompt with Allow and Not now.' },
        { staged: true, say: "The map shows a pin for every geotagged photo, and the public gallery shows them all, no login needed to look. This finished app is a preview of what the crew assembles.", shot: 'Staged: the map with pins; the public gallery grid.' },
        { camera: 'story', say: "Tyler texts the boss a link. Done. Then goes back to sleep for ten more minutes.", shot: 'The reply bubble with the link; Tyler pulls the blanket back up.' },
        { say: "You sleep. The crew works. Join the waitlist and give them something to do tonight.", shot: 'End card: the pitch and the waitlist link.' },
      ],
    },
  ],
  short: {
    title: 'The boss texts at 11 PM (60 seconds)',
    scenes: [
      { camera: 'story', say: "Eleven PM. Tyler's in bed when the boss texts: we're having an event, I need a public photo gallery up for all the employees. Right now.", shot: 'Bedroom, the text bubble.' },
      { say: "Tyler doesn't even sit up. Amber, build me a gallery with user accounts and GPS tagging. Approve, approve.", shot: 'Voice overlay; two approval cards tapped.' },
      { camera: 'story', say: "Get that done, I need it in the morning. Lights out.", shot: 'Phone face down, lights off.' },
      { staged: true, say: "The crew takes the night shift in the group chat, a preview here. This guy's asleep and we're up all night working. Here you go, finish that.", shot: 'Staged group chat banter between Patches, Polo, Jennifer and Brownie.', app: 'console-web' },
      { staged: true, say: "Seven AM. Tyler yawns, rolls over, and boom. Login, photo uploads with opt-in location, a map of every pin, and a public gallery. Ready.", shot: 'Staged: login, consent prompt, map, gallery.' },
      { say: "You sleep. The crew works. Tyler texts the boss a link and goes back to bed. Join the waitlist.", shot: 'The reply bubble with the link; end card.' },
    ],
  },
  extra: {
    id: 'uncut-banter',
    title: 'The night shift, uncut (extra)',
    note: 'The full overnight chat as a scrolling extra. Still nothing crude: it is edgier in the jokes, not the words.',
    scenes: [
      { staged: true, app: 'console-web', say: "This is the full night shift, uncut, and it's a scripted preview of the group chat. Patches: Order's in. Gallery, accounts, GPS. The owner said, and I quote, get that done, then started snoring. We all heard it.", shot: 'Staged Breakroom chat, a preview, scrolling slowly.' },
      { staged: true, app: 'console-web', say: "Polo: Do we get overtime? Patches: You're an AI. Your overtime is more tokens. Polo: Then I'm rich.", shot: 'Staged chat continues; a laughing reaction.' },
      { staged: true, app: 'console-web', say: "Jennifer: Snack break at two. I'm serving leftover cache. It's a little stale but it's free.", shot: 'Staged chat: a pizza emoji.' },
      { staged: true, app: 'console-web', say: "Ashes: Nobody touch the location code until there's a consent screen. I will flag it. I will flag all of you.", shot: 'Staged chat: a red shield reaction.' },
      { staged: true, app: 'console-web', say: "Brownie: I tested the upload with forty pictures of a sandwich. All tagged. All delicious. Map is correct to the deli.", shot: 'Staged chat: a map screenshot with one pin.' },
      { staged: true, app: 'console-web', say: "Landin' Lenny: Merge queue's clear. Landing it. Somebody tell the boss's boss it was easy. Don't tell them how easy.", shot: 'Staged chat: the Landed badge.' },
      { staged: true, app: 'console-web', say: "Marco: Good work. Owner approved the deploy before bed, so it's going out. I'm writing up a raise recommendation for whoever made the coffee. Jennifer: It was virtual. Marco: So's the raise.", shot: 'Staged chat: sunrise colours creep into the window behind the chat.' },
    ],
  },
};
