#!/usr/bin/env node
/**
 * Self-test for the Wake listener core, store and CLI (wake-listener@1): settings normalised and patched, wake phrases
 * matched (lead-in words, longest phrase, word boundary), the state machine (idle → awake → command, wizard has the
 * floor, the switch), the banner light, the store's JSON and the CLI's answers.
 *
 *   node apps/console-web/plugins/wake-listener/test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'axf-wake-listener-'));
process.env.AXF_WAKE_LISTENER_DATA_DIR = dataDir;
const core = await import('./core.mjs');
const store = await import('./listener.mjs');
const { normalizeSettings, normalizePhrases, applyPatch, matchWake, isBareWake, pickEngine, initialState, hear, sleep, wizardOn, wizardOff, switched, light, stateLine, DEFAULT_PHRASES } = core;

let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.log(`FAIL ${what}`); } };
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code; } };

/* settings */
const d = normalizeSettings(null);
ok(d.on === true && d.phrases.join('|') === DEFAULT_PHRASES.join('|') && d.engine === 'auto' && d.awakeSec === 8 && d.indicator === 'always', 'defaults');
ok(normalizeSettings({ on: 'false', awakeSec: 500, engine: 'bogus', phrases: 'Hey Console, AMBER!, , hey console' }).awakeSec === 60, 'awakeSec clamped');
ok(normalizeSettings({ on: 'false' }).on === false, 'on from a string');
ok(normalizeSettings({ engine: 'bogus' }).engine === 'auto', 'unknown engine → auto');
ok(normalizePhrases('Hey Console, AMBER!, , hey console').join('|') === 'hey console|amber', 'phrases cleaned and deduped');
ok(normalizePhrases(Array.from({ length: 30 }, (_, i) => `p${i}`)).length === 12, 'at most 12 phrases');
ok(normalizeSettings({ phrases: [] }).phrases.length === 2, 'no phrases → the defaults (never none)');
const patched = applyPatch(d, { addPhrase: 'Gizmo', speak: false });
ok(patched.phrases.includes('gizmo') && patched.speak === false, 'applyPatch adds a phrase and sets a flag');
ok(applyPatch(patched, { removePhrase: 'gizmo' }).phrases.length === 2, 'removePhrase');
ok(throwsCode(() => applyPatch(d, { bogus: 1 }), 'invalid'), 'unknown key → invalid');

/* wake phrase */
ok(matchWake('Hey Console, approve', ['hey console']).rest === 'approve', 'lead-in + phrase + command');
ok(matchWake('ok amber', ['amber']).rest === '' && isBareWake('ok amber', ['amber']), 'bare wake');
ok(matchWake('amberly open builds', ['amber']) === null, 'word boundary: amberly is not amber');
ok(matchWake('hey console app open settings', ['hey console', 'hey console app']).wake === 'hey console app', 'longest phrase wins');
ok(matchWake('open builds', ['amber']) === null, 'no phrase → null');
ok(pickEngine('auto', { native: true, webspeech: true }) === 'native' && pickEngine('auto', { webspeech: true }) === 'webspeech' && pickEngine('off', { native: true }) === 'none' && pickEngine('native', {}) === 'none', 'pickEngine');

/* state machine */
const s = normalizeSettings({ phrases: ['amber'], awakeSec: 5 });
let st = initialState(s, 1000);
ok(st.phase === 'idle' && st.on, 'initial idle');
let r = hear(st, s, 'open builds', 1000);
ok(r.event === 'ignored' && r.state.lastHeard === 'open builds', 'asleep: ignored but logged');
r = hear(r.state, s, 'amber', 2000);
ok(r.event === 'wake' && r.state.phase === 'awake' && r.state.awakeUntil === 7000 && r.state.lastWake === 'amber', 'wake → awake for awakeSec');
r = hear(r.state, s, 'approve', 3000);
ok(r.event === 'command' && r.command === 'approve' && r.state.phase === 'idle', 'command inside the window, back to idle');
r = hear(initialState(s, 0), s, 'Amber, approve all pending', 10);
ok(r.event === 'command' && r.command === 'approve all pending', 'phrase + command in one breath');
let late = hear(initialState(s, 0), s, 'amber', 0).state;
ok(sleep(late, 6000).phase === 'idle' && sleep(late, 3000).phase === 'awake', 'sleep after the window');
ok(hear(late, s, 'open builds', 9000).event === 'ignored', 'too late: ignored');
const w = wizardOn(initialState(s, 0));
ok(w.phase === 'wizard' && hear(w, s, 'Gizmo Johnson', 1).event === 'wizard' && hear(w, s, 'Gizmo Johnson', 1).command === 'gizmo johnson', 'wizard has the floor, no wake word needed');
ok(hear(w, s, 'amber yes', 1).command === 'yes', 'wake phrase in front of an answer is fine');
ok(wizardOff(w).phase === 'idle' && wizardOn(switched(w, false)).phase === 'off', 'wizardOff / off stays off');
const off = switched(initialState(s, 0), false);
ok(off.phase === 'off' && !off.on && hear(off, s, 'amber', 1).event === 'ignored' && switched(off, true).phase === 'idle', 'the switch');

/* light + line */
ok(light(off).label === 'Mic off' && !light(off).lit, 'light off');
ok(light({ ...initialState(s), listening: true }).tone === 'success' && light({ ...w, listening: true }).tone === 'accent' && light({ ...late, listening: true }).tone === 'warning' && light({ ...initialState(s), listening: true, error: 'x' }).tone === 'danger', 'light tones');
ok(stateLine(off, s).startsWith('Wake listener off'), 'stateLine off');

/* store */
const s1 = store.readSettings();
ok(s1.on && s1.phrases.length === 2 && s1.updatedAt === '', 'store defaults before a write');
const s2 = store.writeSettings({ addPhrase: 'hey gizmo', on: false }, 'test');
ok(s2.phrases.includes('hey gizmo') && !s2.on && s2.updatedBy === 'test' && store.readSettings().updatedBy === 'test', 'writeSettings persists');
const st1 = store.readState(Date.now());
ok(st1.phase === 'off' && !st1.fresh && st1.line.startsWith('Wake listener off'), 'state follows the switch when nothing reported');
store.writeSettings({ on: true });
store.writeState({ phase: 'idle', engine: 'webspeech', listening: true, micOpen: true, lastHeard: 'amber' });
const st2 = store.readState(Date.now());
ok(st2.fresh && st2.listening && st2.engine === 'webspeech' && st2.lastHeard === 'amber', 'reported state read back fresh');
ok(!store.readState(Date.now() + 10 * 60_000).listening, 'stale report: not listening');

/* CLI */
const cli = (...a) => JSON.parse(execFileSync('node', [new URL('./listener.mjs', import.meta.url).pathname, ...a, '--json'], { env: process.env, encoding: 'utf8' }).trim().split('\n').pop());
ok(cli('settings').settings.phrases.includes('hey gizmo'), 'cli settings');
ok(cli('phrases', 'add', 'hey', 'console', 'app').phrases.includes('hey console app'), 'cli phrases add');
ok(cli('off').on === false && cli('on').on === true, 'cli on/off');
ok(cli('set', 'awakeSec=12', 'speak=false').settings.awakeSec === 12 && cli('settings').settings.speak === false, 'cli set');
ok(cli('hear', 'hey', 'gizmo', 'approve').event === 'command' && cli('hear', 'hey gizmo approve').command === 'approve', 'cli hear dry run');
ok(cli('state').state.phase !== undefined, 'cli state');

console.log(`${n - failed}/${n} wake-listener checks passed`);
process.exit(failed ? 1 : 0);
