/**
 * Self-test for triggers@1 on the web port (CI: npx -y tsx framework/spec/check-triggers.mts).
 *  1. replays spec/fixtures/triggers.json against core/triggers.ts (the Kotlin kernel's TriggersConformanceTest replays the same file)
 *  2. drives a tiny host: a registry fed by two modules, observations through the matcher, lib-voice commands hosted
 *     as triggers (Voice Vault's phrases keep matching at 80 %), and a settings binding turning phrases into changes.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ANY_CONTEXT, DEFAULT_COOLDOWN_MS, DEFAULT_THRESHOLD, PlaceholderDetector, SETTINGS_SET_ACTION, SETTINGS_TOGGLE_ACTION, SLOT_TYPES, THRESHOLD_MAX, THRESHOLD_MIN,
  TRIGGERS_CAPABILITY, TRIGGERS_CONTRACT, TRIGGER_ARMINGS, TRIGGER_OUTCOMES, TRIGGER_PLACEHOLDERS, TRIGGER_SOURCES, TriggerRegistry, VOICE_COMMAND_THRESHOLD,
  bindingTriggers, clampThreshold, contextsOverlap, isNamespacedId, matchPhrase, matchTriggers, parsePattern, parseSpokenNumber, parseSpokenSeconds, patternErrors, patternWords,
  registerTriggerKind, settingChangeFor, triggerKind, triggerKinds, validateTrigger, voiceCommandTrigger, type Trigger, type TriggerDiagnostic,
} from '../core/triggers';

const f = JSON.parse(readFileSync(new URL('./fixtures/triggers.json', import.meta.url), 'utf8'));
let checks = 0;
const norm = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const eq = (a: unknown, b: unknown, what: string) => { assert.deepEqual(norm(a), norm(b), what); checks++; };

/* ---------- 1. fixture replay ---------- */
eq(TRIGGERS_CONTRACT, f.contract, 'contract');
eq(TRIGGERS_CAPABILITY, f.capability, 'capability');
eq(TRIGGER_PLACEHOLDERS, f.placeholders, 'placeholders');
eq(triggerKinds(), f.kinds, 'kinds');
eq(TRIGGER_SOURCES, f.sources, 'sources');
eq(TRIGGER_ARMINGS, f.armings, 'armings');
eq(TRIGGER_OUTCOMES, f.outcomes, 'outcomes');
eq(SLOT_TYPES, f.slotTypes, 'slot types');
eq([THRESHOLD_MIN, THRESHOLD_MAX, DEFAULT_THRESHOLD, DEFAULT_COOLDOWN_MS, ANY_CONTEXT, VOICE_COMMAND_THRESHOLD], [f.threshold.min, f.threshold.max, f.threshold.default, f.threshold.cooldownMs, f.threshold.anyContext, f.threshold.voiceCommand], 'threshold constants');
for (const c of f.threshold.clamp) eq(clampThreshold(c.n === 'NaN' ? Number.NaN : c.n), c.clamped, `clamp ${c.n}`);
for (const c of f.ids) eq(isNamespacedId(c.id), c.ok, `id ${c.id}`);
for (const c of f.validate) eq(validateTrigger(c.raw), c.result, `validate ${c.name}`);
for (const c of f.patterns) eq({ parts: parsePattern(c.pattern), error: patternErrors(c.pattern), words: patternWords(c.pattern) }, { parts: c.parts, error: c.error, words: c.words }, `pattern "${c.pattern}"`);
for (const c of f.phrases) eq(matchPhrase(c.heard, c.pattern), c.match, `phrase "${c.heard}" ~ "${c.pattern}"`);
for (const c of f.numbers) eq(parseSpokenNumber(c.phrase), c.value, `number "${c.phrase}"`);
for (const c of f.times) eq(parseSpokenSeconds(c.phrase), c.seconds, `time "${c.phrase}"`);
for (const c of f.overlap) eq(contextsOverlap(c.a, c.b), c.overlap, `overlap ${JSON.stringify([c.a, c.b])}`);
const set: Trigger[] = f.triggers;
for (const c of f.matches) eq(matchTriggers(set, c.obs, c.env), c.result, `match ${c.name}`);
{
  const r = f.registry;
  const raised: TriggerDiagnostic[] = [];
  const reg = new TriggerRegistry((d) => raised.push(d));
  const t = (id: string, phrases: string[], action: string, extra: Partial<Trigger> = {}): Trigger => ({ id, kind: 'voice', source: 'permanent', module: 'ai.amberx.axf.notes', label: id, phrases, action, threshold: DEFAULT_THRESHOLD, worksIn: [], arming: 'always', enabled: true, cooldownMs: DEFAULT_COOLDOWN_MS, mutedUntil: 0, ...extra });
  const d1 = reg.register('ai.amberx.axf.notes', set.slice(0, 10));
  const d2 = reg.register('ai.amberx.axf.player', [t('player.next', ['next'], 'player.next', { module: 'ai.amberx.axf.player' }), t('player.rewind', ['back'], 'player.back', { module: 'ai.amberx.axf.player', worksIn: ['player'] })]);
  const d3 = reg.register('ai.amberx.axf.other', [t('notes.add', ['note <text>'], 'other.add', { module: 'ai.amberx.axf.other' }), t('other.tick', ['tick <text>'], 'other.tick', { module: 'ai.amberx.axf.other', worksIn: ['todo'] })]);
  const d4 = reg.register('ai.amberx.axf.cam', set.slice(10));
  eq([d1, d2, d3, d4], r.diagnostics, 'registry diagnostics');
  eq(raised, r.diagnostics.flat(), 'diagnostics were reported');
  eq(reg.list().map((x) => [x.id, x.module]), r.afterRegister, 'registry after register');
  reg.register('ai.amberx.axf.notes', [t('notes.mine', ['remind me <text>'], 'notes.add', { source: 'custom' })]);
  eq({ permanent: reg.remove('todo.add'), missing: reg.remove('nope.x'), custom: reg.remove('notes.mine') }, r.removed, 'remove');
  eq({ bad: reg.update('todo.check', { phrases: [] }), ok: reg.update('todo.check', { phrases: ['check off <text>', 'done with <text>'], threshold: 120 }), missing: reg.update('nope.x', { enabled: false }) }, r.updated, 'update');
  eq(reg.unregister('ai.amberx.axf.player'), r.unregistered, 'unregister');
  eq({ all: reg.list().map((x) => x.id), voice: reg.list({ kind: 'voice' }).map((x) => x.id), todo: reg.list({ context: 'todo' }).map((x) => x.id), cam: reg.list({ module: 'ai.amberx.axf.cam' }).map((x) => x.id), owner: reg.owner('voice', 'Next!')?.id ?? null, noOwner: reg.owner('voice', 'nothing')?.id ?? null }, r.lists, 'lists');
}
for (const c of f.voiceCommands) eq(voiceCommandTrigger(c.command), c.trigger, `voice command ${c.command.id}`);
{
  const b = f.binding;
  eq([SETTINGS_SET_ACTION, SETTINGS_TOGGLE_ACTION], [b.setAction, b.toggleAction], 'settings actions');
  const bound = bindingTriggers(b.input);
  eq(bound, b.triggers, 'binding triggers');
  b.commands.forEach((c: { command: Parameters<typeof settingChangeFor>[0] | null; change: unknown }, i: number) => {
    if (c.command) eq(settingChangeFor(c.command), c.change, `binding change ${i}`);
  });
}

/* ---------- 2. a host over the contract ---------- */
// kinds are an open registry: a detector module can mark a placeholder built
eq(triggerKind('gesture')?.status, 'placeholder', 'gesture is a placeholder');
registerTriggerKind({ ...triggerKind('gesture')!, status: 'built' });
eq(triggerKind('gesture')?.status, 'built', 'gesture marked built');
registerTriggerKind(f.kinds.find((k: { id: string }) => k.id === 'gesture'));
const ph = new PlaceholderDetector('face', TRIGGER_PLACEHOLDERS.face);
eq(await ph.available(), false, 'placeholder detector is not available');
await ph.start(() => {}).then(() => assert.fail('placeholder must refuse'), (e: Error & { capability?: string }) => eq([e.name, e.capability], ['NotImplemented', TRIGGER_PLACEHOLDERS.face], 'placeholder refuses with its capability'));

// Voice Vault's commands hosted as triggers: every default phrase still matches its own command at 80 %
const vault = [
  { id: 'vault.wake', label: 'Global trigger', defaults: ['hey vault', 'voice vault', 'open vault'], module: 'ai.amberx.axf.voicevault' },
  { id: 'vault.store', label: 'Store password', defaults: ['store password', 'save password', 'set password', 'new password', 'add password'], module: 'ai.amberx.axf.voicevault' },
  { id: 'vault.retrieve', label: 'Retrieve password', defaults: ['retrieve password', 'recover password', 'get password', 'find password'], module: 'ai.amberx.axf.voicevault' },
  { id: 'vault.confirm', label: 'Confirm', defaults: ['confirm', 'yes', 'copy it'], module: 'ai.amberx.axf.voicevault' },
  { id: 'vault.cancel', label: 'Cancel', defaults: ['cancel', 'no', 'never mind'], module: 'ai.amberx.axf.voicevault' },
];
const host = new TriggerRegistry();
eq(host.register('ai.amberx.axf.voicevault', vault.map((c) => voiceCommandTrigger(c))), [], 'vault commands register without conflicts');
for (const c of vault) for (const p of c.defaults) {
  const r = matchTriggers(host.list(), { kind: 'voice', heard: [p.toUpperCase() + '!'], at: 10_000 }, { context: 'vault' });
  eq(r.fired?.action, c.id, `"${p}" fires ${c.id}`);
}
eq(matchTriggers(host.list(), { kind: 'voice', heard: ['ok store password now'], at: 10_000 }, { context: 'vault' }).fired?.action, 'vault.store', 'phrase inside more words');
eq(matchTriggers(host.list(), { kind: 'voice', heard: ['store passwod'], at: 10_000 }, { context: 'vault' }).fired?.action, 'vault.store', 'small mishearing');
eq(matchTriggers(host.list(), { kind: 'voice', heard: ['weather today'], at: 10_000 }, { context: 'vault' }).fired, null, 'unrelated speech');

// a notes module joins the same host: a slot phrase and a slot-less phrase, cooldown carried through lastFired
const notes: Trigger[] = [
  { id: 'notes.add', kind: 'voice', source: 'permanent', module: 'ai.amberx.axf.notes', label: 'Note', phrases: ['note <text>'], action: 'notes.add', threshold: 80, worksIn: [], arming: 'always' },
  { id: 'notes.read', kind: 'voice', source: 'permanent', module: 'ai.amberx.axf.notes', label: 'Read', phrases: ['read my list <name>'], action: 'notes.read', threshold: 80, worksIn: ['notes'], arming: 'always', cooldownMs: 1000 },
];
eq(host.register('ai.amberx.axf.notes', notes), [], 'notes register without conflicts');
let env = { context: 'notes', lastFired: {} as Record<string, number> };
let r = matchTriggers(host.list(), { kind: 'voice', heard: ['read my list groceries'], at: 20_000 }, env);
eq(r.fired, { triggerId: 'notes.read', action: 'notes.read', args: { name: 'groceries' }, phrase: 'read my list <name>', heard: 'read my list groceries' }, 'read my list fires with its argument');
env = { ...env, lastFired: r.lastFired };
r = matchTriggers(host.list(), { kind: 'voice', heard: ['read my list groceries'], at: 20_500 }, env);
eq([r.fired, r.decisions.find((d) => d.triggerId === 'notes.read')?.outcome], [null, 'cooldown'], 'same phrase again inside the cooldown');
r = matchTriggers(host.list(), { kind: 'voice', heard: ['note call mum tomorrow'], at: 21_000 }, { context: 'vault' });
eq(r.fired?.args, { text: 'call mum tomorrow' }, 'note works in any context');
eq(host.unregister('ai.amberx.axf.notes'), 2, 'notes leave');
eq(host.list().length, vault.length, 'vault commands stay');

// a settings binding: phrases → setting changes, applied by a tiny settings host
const settings: Record<string, unknown> = { 'axf.voice.sensitivity': 62, 'axf.voice.echo': true };
const bound = bindingTriggers({ key: 'axf.voice.echo', module: 'ai.amberx.axf.voice', label: 'Echo cancellation', phrases: [{ pattern: 'echo cancellation on', value: true }, { pattern: 'echo cancellation off', value: false }, { pattern: 'toggle echo', toggle: true }] });
const apply = (heard: string) => {
  const cmd = matchTriggers(bound, { kind: 'voice', heard: [heard], at: 30_000 }, { context: 'settings' }).fired;
  const ch = cmd ? settingChangeFor(cmd) : null;
  if (ch?.toggle) settings[ch.key] = !settings[ch.key]; else if (ch) settings[ch.key] = ch.value;
  return settings['axf.voice.echo'];
};
eq([apply('echo cancellation off'), apply('toggle echo'), apply('toggle echo'), apply('echo cancellation on'), apply('nothing')], [false, true, false, true, true], 'settings binding drives a setting');

console.log(`✓ triggers@1: ${checks} checks (fixture triggers.json + a host with Voice Vault's commands, a notes module and a settings binding)`);
