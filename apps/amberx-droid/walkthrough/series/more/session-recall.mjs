// Step s20: session recall. Recorded, transcribed voice sessions you can search by asking.
// Consent: recording is a switch the user turns on; Android asks every start and shows a notification while recording;
// the mic track is a separate opt-in; only record people who know they're being recorded.
export default {
  id: 'session-recall', step: 's20', kind: 'hero', title: 'You never lose an idea you said out loud',
  app: 'amberx-droid', viewport: 'phone', skin: 'atelier',
  hook: 'Ask Amber what you said, and hear yourself say it.',
  facts: [
    'Output recorder (apps/console-web/plugins/output-recorder): records what the phone plays (AudioPlaybackCapture); the mic is an opt-in second track, Record my mic too, off by default. Timestamped 30-minute chunks sent to axHub, kept on the phone until axHub confirms, retried offline. One switch in AmberX plus a quick-settings tile; Android asks for consent every start and shows a notification while recording. Recordings list in AmberX and the console.',
    'Every part is transcribed on the VPS with no model tokens and saved with its session; transcripts are searchable.',
    'Staged: recording every voice session automatically, asking Amber to search by voice, and playback that jumps to the exact moment in the original audio.',
  ],
  chapters: [
    {
      id: 'lost', title: 'It was right there',
      scenes: [
        { camera: 'story', say: "Maya is sure of it. Sometime last week, on a walk, Maya talked through the perfect name for the new product. It was brilliant. And now it's gone.", shot: 'Maya at a desk, frowning at a blank notebook page.' },
        { camera: 'story', say: "Which day? Which session? No idea. There were a dozen voice sessions that week.", shot: 'Close on Maya rubbing their forehead.' },
        { say: "Hi, I'm Amber. Recording and transcripts are real today. Asking me to find a moment and jumping straight to it in the audio is a preview.", shot: 'AmberX Home; the Preview legend fades in.' },
      ],
    },
    {
      id: 'record', title: 'How it was recorded',
      scenes: [
        { say: "Here's why it isn't gone. Maya turned on session recording. It's one switch in AmberX, or a quick-settings tile.", shot: 'AmberX recorder settings: the main switch; the quick-settings tile.' },
        { say: "Every time it starts, Android asks for permission, and a notification stays up the whole time it's recording. You always know.", shot: 'The Android consent dialog; the persistent recording notification.' },
        { say: "Your own microphone is a separate switch, off until you turn it on. And only record people who know they're being recorded. If someone else is in the conversation, tell them, or turn it off.", shot: 'Settings: Record my mic too, off by default; the consent note.' },
        { say: "Recordings go to axHub in thirty-minute pieces. Each piece stays on the phone until the hub confirms it has it, so nothing is lost when you're offline.", shot: 'Recordings list: chunks with timestamps and a synced tick.' },
        { say: "Then every piece is transcribed on your own server. No tokens, no third party. The text is saved with its session.", shot: 'A recording opened: its transcript underneath.' },
      ],
    },
    {
      id: 'ask', title: 'Just ask',
      scenes: [
        { staged: true, say: "So Maya asks. Amber, find where I talked about a name for the new product. This search-by-voice is a preview.", shot: 'Staged: voice overlay with the question.' },
        { say: "Behind it, it's a search across every transcript of every session. You can do it by hand today: type product name into the transcript search, and every match comes back with its session and time.", shot: 'Console: transcript search for "product name"; matches with session and timestamp.' },
        { say: "Search is on the words, not just titles, so it finds the moment even when Maya said it in a rambling way, halfway through a story about something else.", shot: 'Search results with the matching words highlighted inside long transcript lines.' },
        { staged: true, say: "Amber narrows it down. Tuesday, four eighteen PM, on a walk. Here's the bit of the transcript.", shot: 'Staged: one result card, the transcript passage highlighted.' },
        { staged: true, say: "Tap play, and it starts from that exact second. There it is, in Maya's own voice: call it Lantern. It lights the way, and it's easy to say.", shot: 'Staged: the player jumping to 4:18 PM; the waveform; captions.' },
      ],
    },
    {
      id: 'kept', title: 'Kept',
      scenes: [
        { staged: true, say: "Maya says, save that as a note. The note links back to the moment, so the idea and its original audio stay together.", shot: 'Staged: a note card with a link back to the recording.' },
        { camera: 'story', say: "Maya writes Lantern at the top of the notebook page, and underlines it twice.", shot: 'The notebook; the word written and underlined.' },
        { say: "You never lose an idea you said out loud. Join the waitlist.", shot: 'End card.' },
      ],
    },
  ],
  short: {
    title: 'Never lose an idea you said out loud (60 seconds)',
    scenes: [
      { camera: 'story', say: "Maya came up with the perfect product name on a walk last week, and now can't remember it, or even which day it was.", shot: 'Maya at a blank notebook page.' },
      { say: "But session recording was on. One switch, a consent prompt every time, and a notification the whole time it records. Your own mic is a separate opt-in.", shot: 'Recorder switch; consent dialog; notification.' },
      { say: "Every recording goes to axHub in thirty-minute pieces, gets transcribed on your own server with no tokens spent, and every transcript is searchable.", shot: 'Transcript search with matches.' },
      { staged: true, say: "So Maya just asks Amber to find it. In this preview, Amber finds Tuesday, four eighteen, shows the transcript, and plays the original audio from that exact second.", shot: 'Staged: the result card and the player.' },
      { say: "Maya writes it down and underlines it twice. You never lose an idea you said out loud. Join the waitlist.", shot: 'The notebook; end card.' },
    ],
  },
};
