/**
 * Self-test for speech@1 on the web port (CI: npx -y tsx framework/spec/check-speech.mts).
 *  1. replays spec/fixtures/speech.json against core/speech.ts (the Kotlin kernel's SpeechConformanceTest replays the same file)
 *  2. drives a fake provider from the queue reducer's effects: the host decides nothing; the placeholder refuses.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PlaceholderSpeechProvider, RATE_DEFAULT, RATE_MAX, RATE_MIN, RATE_STEPS, REPEAT_MODES, SPEECH_CAPABILITY, SPEECH_CONTRACT, SPEECH_QUEUE_EVENTS,
  clampRate, currentSpeech, initialSpeechQueue, reduceSpeechQueue, replaySpeechQueue, stepRate, type SpeakOptions, type SpeakOutcome, type SpeechProvider, type SpeechQueueEvent, type SpeechQueueState,
} from '../core/speech';
import {
  SPEECH_COMMANDS, SpeechPlayer, WebSpeechProvider, browserSpeechSynthesis, createSpeechProvider, speechCommandEvent, speechTriggers, webSpeechAvailable,
  type SpeechSynthesisLike, type SynthUtteranceLike, type SynthVoiceLike,
} from '../core/speech-web';
import { validateTrigger } from '../core/triggers';

const f = JSON.parse(readFileSync(new URL('./fixtures/speech.json', import.meta.url), 'utf8'));
let checks = 0;
const norm = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const eq = (a: unknown, b: unknown, what: string) => { assert.deepEqual(norm(a), norm(b), what); checks++; };

/* ---------- 1. fixture replay ---------- */
eq([SPEECH_CONTRACT, SPEECH_CAPABILITY, { min: RATE_MIN, max: RATE_MAX, default: RATE_DEFAULT, steps: RATE_STEPS }, REPEAT_MODES, SPEECH_QUEUE_EVENTS], [f.contract, f.capability, f.rate, f.repeatModes, f.events], 'constants');
for (const c of f.clamp) eq(clampRate(c.rate === 'NaN' ? Number.NaN : c.rate), c.clamped, `clamp ${c.rate}`);
for (const c of f.steps) eq({ up: stepRate(c.rate, 1), down: stepRate(c.rate, -1) }, { up: c.up, down: c.down }, `step ${c.rate}`);
for (const s of f.sessions) {
  const events: SpeechQueueEvent[] = s.steps.map((st: { event: SpeechQueueEvent }) => st.event);
  eq(replaySpeechQueue(events, s.rate, s.repeat).map((st, i) => ({ event: events[i], state: st.state, effects: st.effects })), s.steps, `session ${s.name}`);
  let state: SpeechQueueState = initialSpeechQueue(s.rate, s.repeat);
  for (const st of s.steps) { const step = reduceSpeechQueue(state, st.event); eq(step, { state: st.state, effects: st.effects }, `${s.name}: ${st.event.type}`); state = step.state; }
}

/* ---------- 2. a host over the reducer ---------- */
const ph = new PlaceholderSpeechProvider();
eq([await ph.available(), await ph.voices()], [false, []], 'placeholder is not available and has no voices');
await ph.speak('hi').then(() => assert.fail('must refuse'), (e: Error & { capability?: string }) => eq([e.name, e.capability], ['NotImplemented', SPEECH_CAPABILITY], 'placeholder refuses with its capability'));

/** A fake provider that records what it was asked to say and finishes when told. */
class FakeProvider implements SpeechProvider {
  readonly id = 'fake'; readonly label = 'Fake';
  readonly said: string[] = [];
  private finish: ((o: SpeakOutcome) => void) | null = null;
  async available() { return true; }
  speak(text: string, opts?: SpeakOptions) { this.said.push(`${text}@${opts?.rate ?? 1}`); return new Promise<SpeakOutcome>((r) => { this.finish = r; }); }
  async stop() { this.finish?.('stopped'); this.finish = null; }
  async voices() { return [{ id: 'en-1', label: 'English', language: 'en' }]; }
  done() { this.finish?.('done'); this.finish = null; }
}
const provider = new FakeProvider();
let state = initialSpeechQueue();
const log: string[] = [];
const dispatch = (e: SpeechQueueEvent) => {
  const step = reduceSpeechQueue(state, e);
  state = step.state;
  for (const fx of step.effects) {
    if (fx.effect === 'stop') { log.push('stop'); void provider.stop(); }
    else { log.push(`speak ${fx.item.id}`); void provider.speak(fx.item.text, { rate: fx.rate }).then((o) => { if (o !== 'stopped') dispatch({ type: 'done', outcome: o }); }); dispatch({ type: 'started' }); }
  }
};
dispatch({ type: 'enqueue', item: { id: 'a', text: 'Milk' } });
dispatch({ type: 'enqueue', item: { id: 'b', text: 'Eggs' } });
dispatch({ type: 'faster' });
provider.done(); await Promise.resolve(); await Promise.resolve();
provider.done(); await Promise.resolve(); await Promise.resolve();
eq([provider.said, log, currentSpeech(state), state.index], [['Milk@1', 'Milk@1.25', 'Eggs@1.25'], ['speak a', 'stop', 'speak a', 'speak b'], null, 2], 'the host only follows effects');
dispatch({ type: 'again' });
eq([provider.said.at(-1), state.speaking], ['Eggs@1.25', true], 'again repeats the last item');
dispatch({ type: 'clear' });
eq([log.at(-1), state.items, state.speaking], ['stop', [], false], 'clear stops and empties');

/* ---------- 3. web: SpeechSynthesis provider + player ---------- */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// node has no speechSynthesis: every guard holds
eq([browserSpeechSynthesis(), webSpeechAvailable(), createSpeechProvider() instanceof PlaceholderSpeechProvider], [null, false, true], 'no SpeechSynthesis → placeholder');
const bare = new WebSpeechProvider();
eq([await bare.available(), await bare.speak('hi'), await bare.voices()], [false, 'failed', []], 'a provider without synthesis never throws');

class FakeUtterance implements SynthUtteranceLike {
  lang = ''; rate = 1; pitch = 1; voice: SynthVoiceLike | null = null;
  onstart: ((ev?: unknown) => void) | null = null;
  onend: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: { error?: string }) => void) | null = null;
  constructor(public text: string) {}
}
class FakeSynth implements SpeechSynthesisLike {
  spoken: FakeUtterance[] = []; cancels = 0; list: SynthVoiceLike[] = [];
  private onVoices: (() => void) | null = null;
  speak(u: SynthUtteranceLike) { this.spoken.push(u as FakeUtterance); }
  cancel() { this.cancels++; this.spoken.at(-1)?.onerror?.({ error: 'interrupted' }); }
  getVoices() { return this.list; }
  addEventListener(_t: 'voiceschanged', fn: () => void) { this.onVoices = fn; }
  removeEventListener() { this.onVoices = null; }
  loadVoices(v: SynthVoiceLike[]) { this.list = v; this.onVoices?.(); }
  end() { this.spoken.at(-1)?.onend?.(); }
  fail(error: string) { this.spoken.at(-1)?.onerror?.({ error }); }
}
const synth = new FakeSynth();
const web = new WebSpeechProvider(synth, (t) => new FakeUtterance(t), 50);
const voicesP = web.voices();
synth.loadVoices([{ voiceURI: 'v-gb', name: 'Daniel', lang: 'en-GB', localService: true }, { voiceURI: 'v-de', name: 'Anna', lang: 'de-DE', localService: false }]);
eq(await voicesP, [{ id: 'v-de', label: 'Anna (de-DE)', language: 'de-DE', kind: 'network' }, { id: 'v-gb', label: 'Daniel (en-GB)', language: 'en-GB', kind: 'local' }], 'voices wait for voiceschanged, sorted');
eq(await web.available(), true, 'fake synthesis is available');
const p1 = web.speak('Hello', { rate: 3, pitch: 0.7, language: 'en-GB', voice: 'Daniel' });
const u1 = synth.spoken.at(-1)!;
eq([u1.text, u1.rate, u1.pitch, u1.lang, u1.voice?.voiceURI], ['Hello', 2, 0.7, 'en-GB', 'v-gb'], 'utterance gets clamped rate, pitch, language, voice');
synth.end();
eq(await p1, 'done', 'onend → done');
const p2 = web.speak('one');
const p3 = web.speak('two');
eq(await p2, 'stopped', 'a new speak stops the old one');
await web.stop();
eq(await p3, 'stopped', 'stop → stopped');
const p4 = web.speak('bad'); synth.fail('synthesis-failed');
eq(await p4, 'failed', 'other errors → failed');

// the player over the web provider
const s2 = new FakeSynth();
const player = new SpeechPlayer(new WebSpeechProvider(s2, (t) => new FakeUtterance(t)), { defaults: () => ({ language: 'en-US' }) });
const seen: number[] = [];
const unsub = player.subscribe((st) => seen.push(st.index));
player.enqueue('Milk'); player.enqueue('Eggs');
await tick();
eq([s2.spoken.map((u) => u.text), s2.spoken[0]!.lang, player.state.speaking, player.active], [['Milk'], 'en-US', true, true], 'player speaks the first item with the defaults');
player.faster(); await tick();
eq([s2.spoken.map((u) => `${u.text}@${u.rate}`), player.state.index], [['Milk@1', 'Milk@1.25'], 0], 'faster restarts at the next step; the late stop does not move the queue');
s2.end(); await tick();
eq([s2.spoken.at(-1)!.text, player.state.index], ['Eggs', 1], 'done → next item');
eq(player.command('speech.pause'), true, 'speech.pause is a command');
await tick();
eq([player.state.paused, player.state.speaking, player.active], [true, false, false], 'paused');
player.command('speech.resume'); await tick();
eq(s2.spoken.at(-1)!.text, 'Eggs', 'resume says the item again');
player.say('Now'); await tick();
eq([player.state.items.map((i) => i.text), s2.spoken.at(-1)!.text], [['Now'], 'Now'], 'say interrupts and clears');
s2.end(); await tick();
eq([player.active, player.lastOutcome, player.command('notes.add')], [false, 'done', false], 'queue over; unknown actions refused');
unsub();
eq(seen.length > 0, true, 'subscribers see changes');

// an engine that fails everything clears instead of looping (repeat all)
const failing = new SpeechPlayer(new PlaceholderSpeechProvider(), { repeat: 'all' });
failing.enqueue('a'); failing.enqueue('b');
for (let i = 0; i < 5; i++) await tick();
eq([failing.state.items.length, failing.lastOutcome], [0, 'failed'], 'all failing → cleared');

// spoken controls as triggers@1 data
const trig = speechTriggers();
eq(trig.map((t) => validateTrigger(t).ok), trig.map(() => true), 'speech triggers validate');
const phrases = trig.flatMap((t) => t.phrases);
eq(['pause', 'skip', 'faster', 'slower', 'repeat', 'stop reading'].every((p) => phrases.includes(p)), true, 'required phrases present');
eq(SPEECH_COMMANDS.map((c) => [c.action, speechCommandEvent(c.action)?.type]), [['speech.pause', 'pause'], ['speech.resume', 'resume'], ['speech.skip', 'skip'], ['speech.faster', 'faster'], ['speech.slower', 'slower'], ['speech.repeat', 'again'], ['speech.stop', 'clear']], 'actions → queue events');
eq(speechCommandEvent('nope'), null, 'unknown action');

console.log(`✓ speech@1: ${checks} checks (fixture speech.json + a host over the queue reducer + web provider/player)`);
