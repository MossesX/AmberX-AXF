#!/usr/bin/env node
/**
 * chat-audio@1 + voice@1 (core/engines/chat-audio.mjs): the group chat read aloud. Computes every case below, replays
 * spec/fixtures/chat-audio.json (the contract a Kotlin twin replays), validates the shipped voice assets
 * (assets/voice/*.json) and the registry entry, and checks the voice cast covers the shipped crew.
 *
 *   node framework/spec/check-chat-audio.mjs [--write]
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from '../core/engines/chat-audio.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FX = join(ROOT, 'spec/fixtures/chat-audio.json');
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const fails = [];
const test = (name, fn) => { try { fn(); } catch (e) { fails.push(`${name}: ${e.message}`); } };

const AGENTS = ['kat', 'rio', 'tex'];
const cast = A.normCast({ $axf: 'asset@1', type: 'voice', id: 'fx', name: 'Fixture', version: '1.0.0', data: {
  default: { rate: 1, pitch: 1 },
  agents: { kat: { gender: 'female', rate: 1.2, pitch: 1.3, prefer: ['Samantha'] }, boss: { rate: 0.9, pitch: 0.8 } },
  pool: [{ pitch: 0.9 }, { pitch: 1.1 }],
} });
const names = { kat: 'Kotlin Kat', rio: 'Rio React', tex: 'Tex Tester' };
const msgs = [
  { id: 'm1', from: 'boss', kind: 'assign', text: 'Kat, you have **s1** — see https://example.com/pr/1' },
  { id: 'm2', from: 'kat', kind: 'banter', text: 'On it. Brett wants it by lunch.' },
  { id: 'm3', from: 'rio', kind: 'report', text: 'Done: the switch is in. ```js\nx()\n```' },
  { id: 'm4', from: 'brett', kind: 'brett', text: 'Nice work' },
  { id: 'm5', from: 'tex', kind: 'banter', text: 'a'.repeat(30) + ' ' + 'word '.repeat(80) },
];
const on = A.normSettings({ enabled: true }, AGENTS);

const computed = {
  normVoice: [A.normVoice({ rate: 9, pitch: -1, volume: 0.5, gender: 'robot', lang: 'xx yy', cloud: { provider: 'openai', voice: 'alloy' }, extra: 1 }), A.normVoice(null)],
  voiceFor: Object.fromEntries(['kat', 'rio', 'tex', 'boss'].map((id) => [id, A.voiceFor(id, cast, on)])),
  voiceForOverride: A.voiceFor('kat', cast, A.normSettings({ voices: { kat: { pitch: 0.5 } } }, AGENTS)),
  pickDeviceVoice: [
    A.pickDeviceVoice({ prefer: ['samantha'] }, [{ name: 'Alex', lang: 'en-US' }, { name: 'Samantha', lang: 'en-US' }]),
    A.pickDeviceVoice({ lang: 'en-GB', gender: 'female' }, [{ name: 'Alex', lang: 'en-US' }, { name: 'Dan', lang: 'en-GB', gender: 'male' }, { name: 'Kate', lang: 'en_GB', gender: 'female' }]),
    A.pickDeviceVoice({ lang: 'fr-FR' }, [{ name: 'Alex', lang: 'en-US' }]),
  ],
  settings: A.normSettings({ enabled: true, volume: 300, mode: 'loud', muted: { kat: true, ghost: true, rio: false }, voices: { tex: { rate: 5, junk: 1 } }, queueMax: 0 }, AGENTS),
  apply: [
    A.applyAudio({}, { enabled: true, volume: 40, mode: 'summaries' }, AGENTS),
    A.applyAudio(on, { mute: 'kat' }, AGENTS),
    A.applyAudio({ ...on, muted: { kat: true, rio: true } }, { unmute: 'all' }, AGENTS),
    A.applyAudio(on, { agent: 'rio', voice: { pitch: 1.4 } }, AGENTS),
    A.applyAudio({ ...on, voices: { rio: { pitch: 1.4 } } }, { agent: 'rio', voice: null }, AGENTS),
    A.applyAudio(on, { mute: 'all' }, AGENTS),
  ],
  skip: Object.fromEntries(['all', 'mentions', 'summaries'].map((mode) => [mode, msgs.map((m) => A.skipReason(m, { ...on, mode, muted: { tex: true } }))])),
  spoken: msgs.map((m) => A.spokenText(m.text, 120)),
  utterance: A.utterance(msgs[1], { ...on, volume: 50 }, cast, names),
  queueFresh: A.enqueue(A.emptyQueue(), msgs, on, cast, names),
  queueBacklog: A.enqueue(A.emptyQueue(), msgs, { ...on, queueMax: 2 }, cast, names, { backlog: true }),
  queueNew: A.enqueue({ ...A.emptyQueue(), lastId: 'm2' }, msgs, on, cast, names),
  describe: [A.describe({}), A.describe({ ...on, mode: 'mentions', muted: { kat: true } }, names)],
};

// queue flow: one at a time, never overlapping
test('queue speaks one line at a time', () => {
  let q = computed.queueNew;
  const a = A.nextUp(q); assert.equal(a.next.id, 'm3'); q = a.queue;
  const b = A.nextUp(q); assert.equal(b.next, null, 'nothing while a line is speaking');
  q = A.finished(q);
  const c = A.nextUp(q); assert.equal(c.next.id, 'm5');
  assert.equal(A.nextUp({ ...c.queue, speaking: null, paused: true }).next, null, 'nothing while paused');
  assert.deepEqual(A.clearQueue(c.queue).items, []); assert.equal(A.clearQueue(c.queue).lastId, 'm5');
});
test('prune drops muted and everything when off', () => {
  const q = computed.queueNew;
  assert.equal(A.prune(q, { ...on, muted: { rio: true } }).items.every((u) => u.from !== 'rio'), true);
  assert.equal(A.prune(q, { ...on, enabled: false }).items.length, 0);
});
test('applyAudio refuses junk', () => {
  assert.throws(() => A.applyAudio(on, { mode: 'loud' }, AGENTS), /mode/);
  assert.throws(() => A.applyAudio(on, { mute: 'ghost' }, AGENTS), /no agent/);
  assert.throws(() => A.applyAudio(on, {}, AGENTS), /nothing/);
});
test('pool voices are stable per id', () => { assert.deepEqual(A.voiceFor('rio', cast, on), A.voiceFor('rio', cast, on)); assert.equal(A.idHash('rio'), A.idHash('rio')); });

// shipped voice assets and the registry
const types = read(join(ROOT, 'schemas/asset-types.json')).types;
test('voice is a registered asset type', () => { assert.ok(types[A.VOICE_TYPE], 'asset-types.json has "voice"'); assert.deepEqual(types[A.VOICE_TYPE].required, ['default']); });
const roster = read(join(ROOT, '../apps/console-web/plugins/agent-swarm/agents/roster.json'));
for (const f of readdirSync(join(ROOT, 'assets/voice')).filter((x) => x.endsWith('.json'))) {
  test(`assets/voice/${f}`, () => {
    const a = read(join(ROOT, 'assets/voice', f));
    assert.deepEqual(A.castErrors(a), []);
    assert.equal(`${a.id}.json`, f);
    if (a.id === 'breakroom') for (const ag of roster.agents) assert.ok(a.data.agents[ag.id], `breakroom names a voice for ${ag.id}`);
  });
}

const fixture = { $axf: 'fixture@1', about: 'group chat audio (core/engines/chat-audio.mjs): voice@1, chat-audio@1, the playback queue; regenerate: node framework/spec/check-chat-audio.mjs --write', ...computed };
if (process.argv.includes('--write')) writeFileSync(FX, `${JSON.stringify(fixture, null, 1)}\n`);
test('fixture replay', () => { const fx = read(FX); for (const k of Object.keys(computed)) assert.deepEqual(computed[k], fx[k], k); });

if (fails.length) { for (const f of fails) console.error(`  ✗ ${f}`); console.error(`check-chat-audio: ${fails.length} failure(s)`); process.exit(1); }
console.log('check-chat-audio: ok (voice@1, chat-audio@1, queue, shipped voice casts, fixture)');
