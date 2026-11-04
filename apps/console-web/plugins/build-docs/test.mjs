#!/usr/bin/env node
/**
 * Build docs self-test: the core (options, budget, jobs, template docs, scripts and their safety), the CLI over a
 * scratch builds store, the host runner's progress parser and the walkthrough recorder's data-script loader.
 *   node apps/console-web/plugins/build-docs/test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as c from './core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; } };
const at = new Date('2026-11-04T12:00:00Z');
const rnd = () => 0.5;

const SRC = c.normSource({
  build: { id: 'demo-plugin', title: 'Demo plugin: a thing (with extras)', status: 'complete', pr: '#12', branch: 'claude/demo', detail: 'Brett, Nov 1: make the demo.',
    steps: [{ id: 's1', text: 'Core engine (demo@1) with tests', done: true, model: 'Fable' }, { id: 's2', text: 'Web page and dialog', done: true }, { id: 's3', text: 'Not yet', done: false }] },
  origin: { said: 'Make me a demo plugin that does the thing.', addenda: [{ text: 'Also a dialog.', at: '2026-11-02' }] },
  report: { path: '_claude/builds/reports/demo-plugin.md', text: '# Demo\n\nThe demo plugin shows the thing on one page.\n\n- tests pass' },
  diff: { files: [{ path: 'apps/console-web/plugins/demo/web/index.tsx', add: 40, del: 2 }] },
  folders: [{ path: 'apps/console-web/plugins/demo', kind: 'plugin', app: 'console-web', name: 'Demo' }],
  screens: [{ kind: 'view', id: 'demo', label: 'Demo', app: 'console-web', url: 'https://console.amberxai.com/#/demo' }, { kind: 'dialog', id: 'demo.ask', label: 'Ask demo', app: 'console-web' }, { kind: 'settings', id: 'demo', label: 'Demo', app: 'console-web' }],
  commands: [{ id: 'demo/state', title: 'State', method: 'GET', path: '/api/plugins/demo/state', mcp: 'demo_state', cli: 'axf demo state' }],
  settings: [{ key: 'demo.on', label: 'Show it', tab: 'demo' }],
  help: [{ id: 'demo', label: 'Demo', text: 'The demo page lists every thing with its state.' }],
  about: 'Shows every thing in one place. More text here.',
});

t('options are clamped and defaulted', () => {
  const v = c.normVideoOptions({ length: 99999, speed: 9, viewport: 'tv', voice: 'nope', theme: 'Bad Id!', features: ['step:s1', 'step:s1', ''] });
  assert.equal(v.length, c.LENGTH_RANGE.max); assert.equal(v.speed, c.SPEED_RANGE.max); assert.equal(v.viewport, 'desktop');
  assert.equal(v.voice, c.VIDEO_DEFAULTS.voice); assert.equal(v.theme, ''); assert.deepEqual(v.features, ['step:s1']);
  const d = c.normDocOptions({ audience: 'x', depth: 'deep', ai: false });
  assert.equal(d.audience, 'me'); assert.equal(d.depth, 'deep'); assert.equal(d.ai, false);
});
t('length buys words and scenes', () => {
  assert.deepEqual(c.budget(60), { seconds: 60, words: 150, scenes: 7 });
  assert.equal(c.budget(30).scenes, 3); assert.equal(c.budget(5).seconds, c.LENGTH_RANGE.min);
  assert.equal(c.fmtLength(90), '1 min 30 s'); assert.equal(c.fmtLength(300), '5 min');
});
t('targets parse and documentable', () => {
  assert.deepEqual(c.parseTarget('demo-plugin/s2'), { build: 'demo-plugin', step: 's2' });
  assert.equal(c.parseTarget('../etc'), null); assert.equal(c.parseTarget('a/b c'), null);
  assert.ok(c.documentable({ status: 'complete', steps: [] })); assert.ok(c.documentable({ status: 'pending', steps: [{ id: 's1', done: true }] }));
  assert.ok(!c.documentable({ status: 'pending', steps: [{ id: 's1', done: false }] })); assert.ok(!c.documentable({ status: 'complete', steps: [{ id: 's1', done: false }] }, 's1'));
});
t('jobs: create, advance, final states stay, rerun keeps options', () => {
  const j = c.createJob({ kind: 'video', targets: ['demo-plugin', 'demo-plugin/s1'], options: { length: 30 } }, at, rnd);
  assert.match(j.id, c.JOB_ID_RE); assert.equal(j.state, 'queued'); assert.equal(j.targets.length, 2);
  const d = c.advance(j, { state: 'done', say: 'ok' }, at);
  assert.equal(d.progress, 100); assert.ok(d.finishedAt); assert.equal(d.log.at(-1).text, 'ok');
  assert.throws(() => c.advance(d, { state: 'recording' }), /is done/);
  const r = c.rerun(d, { options: { viewport: 'phone' } }, 'me', at, rnd);
  assert.equal(r.options.length, 30); assert.equal(r.options.viewport, 'phone'); assert.equal(r.rerunOf, j.id); assert.equal(r.state, 'queued');
  assert.throws(() => c.createJob({ kind: 'nope', targets: ['a'] }), /kind/); assert.throws(() => c.createJob({ kind: 'docs', targets: [] }), /at least one/);
});
t('docs path: the main plugin folder, else docs/builds', () => {
  assert.equal(c.docPath(SRC), 'apps/console-web/plugins/demo/docs/demo-plugin.md');
  assert.equal(c.docPath({ ...SRC, folders: [], build: SRC.build }), 'docs/builds/demo-plugin.md');
  assert.equal(c.docPath({ ...SRC, step: { id: 's2', text: 'x' } }), 'apps/console-web/plugins/demo/docs/demo-plugin-s2.md');
});
t('template docs: every section from the source, verbatim words, nothing invented', () => {
  const md = c.templateDoc(SRC, { audience: 'developer', depth: 'deep', notes: 'the dialog' });
  for (const s of ['# Demo plugin', '## What it does', '### What Brett asked for (verbatim)', '> Make me a demo plugin that does the thing.', '**Addendum 1', '## How to use it', '## Settings', '`demo.on`', '## Commands (voice, API, MCP, CLI)', '`GET /api/plugins/demo/state`', '`demo_state`', '## Files', '## Troubleshooting', 'Covered on request:** the dialog']) assert.ok(md.includes(s), `missing ${s}`);
  assert.ok(!md.includes('Not yet'), 'undone steps stay out');
  const user = c.templateDoc(SRC, { audience: 'end-user' });
  assert.ok(!user.includes('verbatim') && !user.includes('## Commands') && !user.includes('`demo.on`'));
});
t('AI docs answer cleaned or refused', () => {
  assert.equal(c.cleanAiDoc('too short'), '');
  const ok = c.cleanAiDoc('```markdown\n# Demo\n\nSome text that is long enough to be a real document about the demo plugin and what it does for you, every day, on every screen it has.\n<script>alert(1)</script>\n```');
  assert.ok(ok.startsWith('# Demo') && !ok.includes('<script') && ok.includes('Written by Build docs (AI)'));
  const p = c.aiDocPrompt(SRC, { audience: 'me' });
  assert.ok(p.system.includes('Never invent') && p.messages[0].content.includes('Make me a demo plugin'));
});
t('fallback script: intro, screens, steps, outro, fitted and safe', () => {
  const s = c.planScript(SRC, { length: 120, focus: 'the dialog' });
  assert.deepEqual(c.scriptErrors(s), []);
  const ids = s.chapters.map((x) => x.id);
  assert.equal(ids[0], 'intro'); assert.equal(ids.at(-1), 'outro'); assert.ok(ids.includes('focus') && ids.includes('screen-demo') && ids.includes('built'));
  assert.ok(s.chapters[0].scenes[0].say.startsWith('This is Demo plugin.'), s.chapters[0].scenes[0].say);
  assert.ok(s.chapters.flatMap((x) => x.scenes).every((x) => !/@\d/.test(x.say)), 'format ids are not spoken');
  const short = c.planScript(SRC, { length: 20 });
  assert.ok(short.chapters.reduce((k, x) => k + x.scenes.length, 0) <= c.budget(20).scenes);
  const picked = c.planScript(SRC, { length: 300, features: ['step:s2'] });
  assert.deepEqual(picked.chapters.find((x) => x.id === 'built').scenes.length, 1);
  const noCards = c.planScript(SRC, { intro: false, outro: false });
  assert.ok(!noCards.chapters.some((x) => x.id === 'intro' || x.id === 'outro'));
});
t('scripts only carry allowed moves and origins', () => {
  const s = c.normScript({ chapters: [{ id: 'A b!', title: 'x', scenes: [{ say: 'A line long enough to speak.', do: [{ op: 'open', url: 'https://evil.example/' }, { op: 'eval', js: '1' }, { op: 'open', url: 'https://console.amberxai.com/#/x' }, { op: 'click', sel: 'javascript:alert(1)' }, { op: 'wait', ms: 999999 }] }] }] });
  assert.equal(s.chapters[0].id, 'a-b'); assert.deepEqual(s.chapters[0].scenes[0].do, [{ op: 'open', url: 'https://console.amberxai.com/#/x' }, { op: 'wait', ms: 15000 }]);
  assert.ok(c.scriptErrors({ $axf: c.SCRIPT_FORMAT, chapters: [{ scenes: [{ say: 'long enough line here', do: [{ op: 'eval' }] }] }] }).some((e) => e.includes('not allowed')));
  assert.equal(c.parseAiScript('no json here', SRC), null);
  const ai = c.parseAiScript(`Sure: {"chapters":[{"id":"intro","title":"Hi","scenes":[{"say":"Welcome to the demo plugin.","do":[{"op":"card","title":"Demo"}]}]},{"id":"page","title":"Page","scenes":[{"say":"Here is the demo page with every thing.","do":[{"op":"view","name":"demo"},{"op":"rm","x":1}]}]}]}`, SRC, { length: 60 });
  assert.ok(ai && ai.chapters.length === 2 && ai.chapters[1].scenes[0].do.length === 1);
});
t('edit, merge, transcript, feature picks', () => {
  const s = c.planScript(SRC, { length: 120 });
  const e = c.editScript(s, { lines: { 'intro-0': 'A brand new opening line for this.' }, remove: ['outro-0'] });
  assert.equal(e.chapters[0].scenes[0].say, 'A brand new opening line for this.'); assert.ok(!e.chapters.some((x) => x.id === 'outro'));
  const m = c.mergeScripts([s, c.planScript({ ...SRC, build: { ...SRC.build, id: 'other', title: 'Other build' } }, { length: 60 })], { length: 120 });
  assert.equal(m.chapters.filter((x) => x.id === 'intro').length, 1); assert.ok(m.chapters.some((x) => x.id.startsWith('b2-')));
  assert.ok(c.transcript(s).startsWith('# Demo plugin — transcript'));
  assert.deepEqual(c.featureChoices(SRC).map((f) => f.id), ['step:s1', 'step:s2', 'screen:demo', 'screen:demo.ask', 'screen:demo', 'commands']);
  assert.ok(c.scriptSeconds(s) > 0 && c.scriptWords(s) > 10);
});

// ---------------------------------------------------------------- CLI over a scratch store
const tmp = mkdtempSync(join(tmpdir(), 'axf-build-docs-'));
mkdirSync(join(tmp, 'data'), { recursive: true });
writeFileSync(join(tmp, 'store.json'), JSON.stringify({ builds: [
  { id: 'demo-plugin', title: 'Demo plugin', status: 'complete', steps: [{ id: 's1', text: 'Core', done: true }] },
  { id: 'not-yet', title: 'Not yet', status: 'pending', steps: [{ id: 's1', text: 'Core', done: false }] },
] }));
const env = { ...process.env, AXF_BUILD_DOCS_DIR: join(tmp, 'data'), AXF_BUILDS_STORE: join(tmp, 'store.json') };
const cli = (req) => { const r = spawnSync(process.execPath, [join(HERE, 'cli.mjs'), JSON.stringify(req)], { env, encoding: 'utf8' }); return JSON.parse(r.stdout.trim().split('\n').pop()); };
t('cli: index, create refuses unbuilt, the full video flow, cancel', () => {
  assert.equal(cli({ op: 'index' }).builds.length, 2);
  assert.match(cli({ op: 'create', kind: 'docs', targets: ['not-yet'] }).error, /nothing built yet/);
  const j = cli({ op: 'create', kind: 'video', targets: ['demo-plugin'], options: { length: 30 }, by: 'test' }).job;
  assert.equal(j.title, 'Demo plugin');
  assert.equal(cli({ op: 'prepare', id: j.id }).ok, true);
  const p = cli({ op: 'plan-script', id: j.id });
  assert.equal(p.ok, true); assert.ok(p.script.chapters.length >= 2);
  assert.match(cli({ op: 'approve', id: 'vid-000000000000-zzzz' }).error, /no job/);
  const ed = cli({ op: 'edit-script', id: j.id, edits: { lines: { 'intro-0': 'An edited opening line, long enough.' } } });
  assert.equal(ed.script.chapters[0].scenes[0].say, 'An edited opening line, long enough.');
  const a = cli({ op: 'approve', id: j.id });
  assert.equal(a.job.state, 'queued'); assert.match(a.command, /agent-slots\.mjs heavy -- node apps\/console-web\/plugins\/build-docs\/runner\.mjs vid-/);
  assert.match(cli({ op: 'edit-script', id: j.id, edits: {} }).error, /waits for approval/);
  assert.equal(cli({ op: 'cancel', id: j.id }).job.state, 'cancelled');
  const list = cli({ op: 'list' }).jobs; assert.equal(list[0].id, j.id);
});
t('cli: a docs job writes template docs when no AI answer', () => {
  const j = cli({ op: 'create', kind: 'docs', targets: ['demo-plugin/s1'], options: { audience: 'developer' } }).job;
  cli({ op: 'prepare', id: j.id });
  const w = cli({ op: 'write-docs', id: j.id, answers: [''] });
  assert.equal(w.files.length, 1); assert.equal(w.files[0].path, 'docs/builds/demo-plugin-s1.md'); assert.ok(w.files[0].text.includes('# Demo plugin: Core'));
  const g = cli({ op: 'get', id: j.id });
  assert.equal(g.job.state, 'publishing'); assert.equal(g.job.mode, 'template'); assert.ok(g.docs[0].text.includes('## What it does'));
  const r = cli({ op: 'rerun', id: j.id, tweaks: { options: { depth: 'deep' } } });
  assert.equal(r.job.options.depth, 'deep'); assert.equal(r.job.options.audience, 'developer');
});

// ---------------------------------------------------------------- runner + recorder data scripts
const { progressOf } = await import('./runner.mjs');
t('runner: recorder lines → progress', () => {
  const seen = { chapters: 0 };
  assert.deepEqual(progressOf('\x1b[1;33m[walkthrough]\x1b[0m demo data', 3, seen).slice(0, 2), ['recording', 36]);
  assert.equal(progressOf('## intro', 2, seen)[1], 66); assert.equal(progressOf('## outro', 2, seen)[1], 84);
  assert.equal(progressOf('walkthrough: 0.4 min, 3 chapters', 2, seen)[0], 'rendering'); assert.equal(progressOf('random line'), null);
});
const sf = await import('../../../amberx-droid/walkthrough/script-file.mjs');
t('recorder: a data script becomes acts that only call helpers', () => {
  const s = c.planScript(SRC, { length: 60 });
  const w = sf.fromData(s);
  assert.equal(w.CHAPTERS.length, s.chapters.length); assert.deepEqual(w.walkthroughErrors(), []);
  assert.ok(w.CHAPTERS.every((ch) => ch.scenes.every((x) => typeof x.act === 'function')));
});
{
  const calls = [];
  const h = new Proxy({}, { get: (_, k) => async (...a) => { calls.push([k, ...a]); return k === 'navigate' ? false : undefined; } });
  await sf.actOf([{ op: 'card', title: 'T' }, { op: 'view', name: 'demo', label: 'Demo' }, { op: 'eval', js: 'x' }, { op: 'wait', ms: 99999 }])(h);
  t('recorder: moves run in order, unknown ones never', () => {
    assert.deepEqual(calls.map((x) => x[0]), ['card', 'uncard', 'navigate', 'view', 'wait']);
    assert.equal(calls.at(-1)[1], 15000);
  });
}
console.log(process.exitCode ? 'build-docs: FAILED' : `build-docs: ${n} checks passed`);
