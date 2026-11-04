// @ts-nocheck: a Node test, not part of the console's build
/** Agent voice self-test (the pure core). node --experimental-strip-types apps/console-web/plugins/agent-voice/test.mts */
import assert from 'node:assert/strict';
import {
  applyPreset, applyPronunciations, defaultProfile, DEFAULT_MIC, estimateMs, exportProfiles, importProfiles, interpretHeard,
  lightState, micGate, narrate, normMic, normProfile, normStore, numberWords, PRESETS, sentencesOf, splitLong, speakableInline,
} from './web/core.ts';
import { createLease } from './web/lease.ts';

let n = 0;
const t = (name: string, f: () => void) => { try { f(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

const voiced = (patch = {}) => normProfile({ ...defaultProfile('molly'), enabled: true, ...patch }, 'molly');

t('normProfile clamps and drops junk', () => {
  const p = normProfile({ agentId: 'x', rate: 9, pitch: -1, volume: '0.5', engine: 'laser', narrator: { readMode: 'nope', sentences: 400, maxChars: 5 }, permissions: { listen: 'yes' }, junk: 1 });
  assert.equal(p.rate, 2); assert.equal(p.pitch, 0.5); assert.equal(p.volume, 0.5); assert.equal(p.engine, 'device');
  assert.equal(p.narrator.readMode, 'full'); assert.equal(p.narrator.sentences, 20); assert.equal(p.narrator.maxChars, 100);
  assert.equal(p.permissions.listen, false); assert.equal('junk' in p, false);
});
t('normProfile on nothing', () => { const p = normProfile(null, 'a'); assert.equal(p.agentId, 'a'); assert.equal(p.enabled, false); assert.equal(p.permissions.speak, true); });
t('store keeps only valid profiles', () => {
  const s = normStore({ profiles: { a: { enabled: true }, '': {} }, mic: { mode: 'hold', silenceMs: 1 }, pronunciations: [{ from: 'k8s', to: 'kubernetes' }, { from: '' }] });
  assert.deepEqual(Object.keys(s.profiles), ['a']); assert.equal(s.mic.mode, 'hold'); assert.equal(s.mic.silenceMs, 800); assert.equal(s.pronunciations.length, 1);
});
t('mic defaults keep phrases; empty string means none', () => {
  assert.equal(normMic({}).sendPhrase, 'send it'); assert.equal(normMic({ sendPhrase: '' }).sendPhrase, ''); assert.equal(normMic({ cancelPhrase: 'Scrap That' }).cancelPhrase, 'scrap that');
});
t('presets', () => {
  for (const pr of PRESETS) { const p = applyPreset(voiced(), pr.id); assert.equal(p.agentId, 'molly'); assert.equal(p.enabled, true); }
  assert.equal(applyPreset(voiced(), 'briefing').narrator.readMode, 'summary');
  assert.equal(applyPreset(voiced(), 'nope').rate, 1);
});

t('micGate: not installed', () => { const g = micGate({ installed: false, agent: null, profile: null, deviceDenied: false, holder: null, speaking: false, mic: DEFAULT_MIC }); assert.equal(g.ok, false); assert.equal(g.reason, 'not-installed'); assert.equal(g.fix, 'install'); });
t('micGate: names the agent missing permission', () => {
  const g1 = micGate({ installed: true, agent: { id: 'molly', name: 'Molly' }, profile: null, deviceDenied: false, holder: null, speaking: false, mic: DEFAULT_MIC });
  assert.equal(g1.reason, 'not-voice'); assert.match(g1.message, /^Molly is missing permission/);
  const g2 = micGate({ installed: true, agent: { id: 'molly', name: 'Molly' }, profile: voiced(), deviceDenied: false, holder: null, speaking: false, mic: DEFAULT_MIC });
  assert.equal(g2.reason, 'missing-permission'); assert.match(g2.message, /Molly is missing permission: Listen/); assert.equal(g2.fix, 'allow-listen');
});
t('micGate: busy, device, ok + barge-in', () => {
  const p = voiced({ permissions: { listen: true } });
  const base = { installed: true, agent: { id: 'molly', name: 'Molly' }, profile: p, deviceDenied: false, holder: null, speaking: false, mic: DEFAULT_MIC };
  assert.equal(micGate({ ...base, holder: 'dictation' }).reason, 'busy');
  assert.match(micGate({ ...base, holder: 'dictation' }).message, /Dictation is using the microphone/);
  assert.equal(micGate({ ...base, deviceDenied: true }).reason, 'device-denied');
  assert.deepEqual(micGate({ ...base, holder: 'agent-voice', speaking: true }), { ok: true, stopSpeakingFirst: true });
  assert.deepEqual(micGate({ ...base, speaking: true, mic: { ...DEFAULT_MIC, bargeIn: false } }), { ok: true, stopSpeakingFirst: false });
  assert.equal(micGate({ ...base, agent: null }).reason, 'no-agent');
});

t('heard: send / cancel / punctuation', () => {
  assert.deepEqual(interpretHeard('never mind', DEFAULT_MIC), { kind: 'cancel' });
  assert.deepEqual(interpretHeard('open the build list send it', DEFAULT_MIC), { kind: 'send', text: 'Open the build list' });
  assert.deepEqual(interpretHeard('hello comma molly period how are you question mark', DEFAULT_MIC), { kind: 'text', text: 'Hello, molly. How are you?' });
  assert.deepEqual(interpretHeard('first new line second', DEFAULT_MIC), { kind: 'text', text: 'First\nSecond' });
  assert.deepEqual(interpretHeard('keep comma words', { ...DEFAULT_MIC, spokenPunctuation: false }), { kind: 'text', text: 'keep comma words' });
});

t('numbers in words', () => { assert.equal(numberWords(7), 'seven'); assert.equal(numberWords(42), 'forty-two'); assert.equal(numberWords(305), 'three hundred five'); assert.equal(numberWords(12000), 'twelve thousand'); assert.equal(numberWords(2e6), '2000000'); });
t('sentences keep e.g. and versions', () => { assert.deepEqual(sentencesOf('Use v1.2 now. E.g. this works! Then done'), ['Use v1.2 now.', 'E.g. this works!', 'Then done']); });
t('splitLong', () => { const parts = splitLong('a, '.repeat(200), 50); assert.ok(parts.every((p) => p.length <= 50)); assert.ok(parts.length > 5); });
t('pronunciations: whole words, longest first, case', () => {
  const list = [{ from: 'AXF', to: 'A X F', whole: true, caseSensitive: true }, { from: 'AmberX AXF', to: 'the framework', whole: true, caseSensitive: false }];
  assert.equal(applyPronunciations('AmberX AXF and AXF but not axf or AXFs', list), 'the framework and A X F but not axf or AXFs');
});
t('inline: links, code, emphasis, emoji, symbols', () => {
  const n = defaultProfile('x').narrator;
  assert.equal(speakableInline('See [the docs](https://www.example.com/a) 🎉', n).text, 'See the docs (example.com)');
  assert.equal(speakableInline('Go to https://axhub.amberxai.com/x now', n).text, 'Go to a link to axhub.amberxai.com now');
  assert.equal(speakableInline('Run `npm test` -> **done** 50%', n).text, 'Run npm test to done 50 percent');
  assert.equal(speakableInline('**bold**', n).emphasised, true);
  assert.equal(speakableInline('x `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` y', n).text, 'x some code y');
  assert.equal(speakableInline('link https://a.b/c', { ...n, urls: 'skip' }).text, 'link');
});

const REPLY = `# Build status\n\nThe **AmberX** build passed. Two steps are left.\n\n- Merge the PR\n- Install the APK\n\n\`\`\`ts\nconst a = 1;\nconst b = 2;\n\`\`\`\n\n| Step | State |\n|---|---|\n| s1 | done |\n| s2 | left |\n\nThat's all for now.`;

t('narrate: full', () => {
  const c = narrate(REPLY, voiced({ narrator: { intro: '{name} here.' } }), { agentName: 'Molly' });
  const texts = c.map((x) => x.text);
  assert.deepEqual(texts, ['Molly here.', 'Build status', 'The Amber X build passed.', 'Two steps are left.', 'Merge the P R', 'Install the A P K', "There's some ts code here, 2 lines.", 'A table of Step, State, with 2 rows.', "That's all for now."]);
  assert.equal(c.find((x) => x.kind === 'heading').rateMul < 1, true);
  assert.equal(c[c.length - 1].pause, 0);
  assert.ok(estimateMs(c, 1) > 1000);
});
t('narrate: summary / first / numbered lists / code read / skip', () => {
  assert.deepEqual(narrate(REPLY, voiced({ narrator: { readMode: 'first' } })).map((x) => x.text), ['Build status', 'The Amber X build passed.']);
  assert.equal(narrate(REPLY, voiced({ narrator: { readMode: 'summary', sentences: 3, headings: false } })).length, 3);
  assert.ok(narrate(REPLY, voiced({ narrator: { numberLists: true } })).some((x) => x.text === 'one: Merge the P R'));
  assert.ok(narrate(REPLY, voiced({ narrator: { code: 'read' } })).some((x) => x.text === 'const a = 1;'));
  assert.ok(!narrate(REPLY, voiced({ narrator: { code: 'skip' } })).some((x) => /code/.test(x.text)));
});
t('narrate: maxChars cut is announced', () => {
  const c = narrate('One sentence here. '.repeat(60), voiced({ narrator: { maxChars: 120 } }));
  assert.match(c[c.length - 1].text, /rest is on screen/);
});
t('narrate: agent pronunciations beat built-ins', () => {
  const c = narrate('AmberX is up.', voiced({ pronunciations: [{ from: 'amberx', to: 'Ambrex' }] }));
  assert.equal(c[0].text, 'Ambrex is up.');
  assert.equal(narrate('AmberX is up.', voiced(), { builtins: false })[0].text, 'AmberX is up.');
});
t('narrate: empty and emoji-only', () => { assert.deepEqual(narrate('', voiced()), []); assert.deepEqual(narrate('🎉🎉', voiced()), []); });

t('light', () => {
  assert.equal(lightState({ profile: null, speaking: true, paused: false, listening: false, error: false }), 'off');
  assert.equal(lightState({ profile: voiced(), speaking: false, paused: false, listening: false, error: false }), 'ready');
  assert.equal(lightState({ profile: voiced(), speaking: true, paused: false, listening: true, error: false }), 'listening');
  assert.equal(lightState({ profile: voiced(), speaking: true, paused: true, listening: false, error: false }), 'paused');
  assert.equal(lightState({ profile: voiced(), speaking: true, paused: false, listening: false, error: true }), 'error');
});
t('export / import', () => {
  const s = normStore({ profiles: { molly: voiced() }, pronunciations: [{ from: 'k8s', to: 'kubernetes' }] });
  const back = importProfiles(normStore({}), exportProfiles(s));
  assert.equal(back.count, 1); assert.equal(back.store.profiles.molly.enabled, true); assert.equal(back.store.pronunciations.length, 1);
  assert.equal(importProfiles(s, 'nope').error, "That file isn't JSON.");
  assert.match(importProfiles(s, '{"a":1}').error, /agent-voice@1/);
});

t('lease: one holder, release only by holder, listeners', () => {
  const l = createLease();
  const seen = [];
  const off = l.on((h) => seen.push(h));
  assert.equal(l.take('dictation'), true); assert.equal(l.take('agent-voice'), false); assert.equal(l.holder(), 'dictation');
  l.release('agent-voice'); assert.equal(l.holder(), 'dictation');
  l.release('dictation'); assert.equal(l.holder(), null);
  assert.equal(l.take('agent-voice'), true); assert.equal(l.take('agent-voice'), true);
  off(); l.release('agent-voice');
  assert.deepEqual(seen, ['dictation', null, 'agent-voice']);
  assert.equal(l.take('x', 1, () => 0), true); assert.equal(l.take('y', 1, () => 5), true, 'a stale lease expires');
});

console.log(`agent-voice: ${n} checks passed`);
