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

console.log(`✓ speech@1: ${checks} checks (fixture speech.json + a host over the queue reducer)`);
