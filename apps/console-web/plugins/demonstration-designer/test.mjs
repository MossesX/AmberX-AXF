#!/usr/bin/env node
/**
 * Self-test for the Demonstration Designer plugin: the pitch engine (benefit sentences, speakable words, the script
 * fitted to its length, text round trip, record-by-doing steps, settings, deep links), the registry read from the real
 * repo, the store + CLI in a scratch data folder (generate, save, chain, walkthrough, media as clips, settings), and
 * the manifest's command declarations against the routes.
 *
 *   node apps/console-web/plugins/demonstration-designer/test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'axf-demo-designer-test-'));
process.env.AXF_DEMO_DESIGNER_DIR = scratch;
const E = await import('./engine.mjs');
const Reg = await import('./registry.mjs');
const S = await import('./demos.mjs');
const R = await import('../../../../framework/core/engines/demo-rules.mjs');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const cli = (...args) => spawnSync('node', [join(HERE, 'demos.mjs'), ...args], { encoding: 'utf8', env: { ...process.env } });

/* ---------------- engine ---------------- */

ok('speakable drops specs and ids, keeps benefits, ends in a full stop', () => {
  assert.equal(E.speakable('every build lands here (plugin-lifecycle@1, see demos.mjs) for the user'), 'Every build lands here for you.');
  assert.equal(E.speakable('x'), '');
  assert.ok(E.benefitScore('Everything you need in one place, never lost.') > E.benefitScore('Schema plugin-commands@1 runner /api/control validator engine.'));
});

ok('benefit sentences come best first and never carry code', () => {
  const b = E.benefitSentences('The ledger keeps every feature in one place. Engine `x.mjs` validates plugin-lifecycle@1 fixtures. You never lose a change, and the history stays with it.');
  assert.ok(b.length >= 2);
  assert.ok(b[0].includes('one place') || b[0].includes('never'));
  for (const s of b) assert.ok(!/@1|\.mjs|`/.test(s), s);
});

const topic = E.normalizeTopic({
  id: 'plugin:sample', kind: 'plugin', label: 'Sample', plugin: 'sample',
  description: 'Sample keeps every pitch in one place so you never lose one. Builds submit through sample.mjs (plugin-commands@1). The list shows what is waiting; one tap plays it anywhere.',
  screens: [
    { view: 'sample', label: 'Sample page', text: 'Everything waiting for you, newest first.', controls: [{ label: 'Play', text: 'Plays the pitch on the live console.' }, { label: 'Export', text: 'Keeps the recording as a clip you can share.' }, { label: 'Settings', text: '' }] },
    { view: 'sample-more', label: 'More', text: '', controls: [] },
  ],
});

ok('a pitch has a hook first, the call to action last, scenes that open their screens, and valid demonstration@1 data', () => {
  const p = E.generatePitch(topic, { minutes: 2, cta: 'Try it today.' });
  assert.equal(p.$axf, 'pitch-script@1');
  assert.equal(p.data.steps[0].title, 'Hook');
  assert.ok(p.data.steps[0].say.startsWith('Meet Sample.'));
  assert.equal(p.data.steps.at(-1).say, 'Try it today.');
  assert.ok(p.data.steps.some((s) => s.do === 'nav:sample' && s.target.includes('[data-axf-view="sample"]')));
  assert.ok(p.data.steps.some((s) => s.target === 'text=Play'));
  assert.deepEqual(R.demoAssetErrors('demonstration', p.data), []);
  assert.equal(p.id, 'pitch-sample-2m');
  assert.ok(p.plan.seconds > 60 && p.plan.seconds <= 130, `seconds ${p.plan.seconds}`);
  for (const s of p.data.steps) assert.ok(!/@1|\.mjs/.test(s.say), s.say);
});

ok('the length is fitted: a 1-minute pitch is shorter than a 5-minute one and cuts the weakest beats, never the hook or the closing', () => {
  const one = E.generatePitch(topic, { minutes: 1 }); const five = E.generatePitch(topic, { minutes: 5 });
  assert.ok(one.plan.seconds <= 70, `one ${one.plan.seconds}`);
  assert.ok(five.plan.seconds > one.plan.seconds);
  assert.equal(one.data.steps[0].title, 'Hook'); assert.equal(one.data.steps.at(-1).title, 'Call to action');
  assert.ok(five.plan.dwell >= one.plan.dwell);
});

ok('the script round-trips through text; a tweaked block keeps its action and target', () => {
  const p = E.generatePitch(topic, { minutes: 2 });
  const text = E.scriptText(p.data.steps);
  assert.ok(text.startsWith('# Hook\n'));
  const back = E.parseScript(text, p.data.steps);
  assert.deepEqual(back, p.data.steps);
  const tweaked = E.parseScript(text.replace('Meet Sample.', 'Say hello to Sample.'), p.data.steps);
  assert.ok(tweaked[0].say.startsWith('Say hello to Sample.'));
  assert.equal(tweaked[1].do, p.data.steps[1].do);
  assert.deepEqual(E.parseScript('', p.data.steps), p.data.steps);
});

ok('record by doing: screen changes open screens, taps highlight controls, repeats merge, a hook is added', () => {
  const steps = E.stepsFromRecording([{ kind: 'nav', view: 'builds', label: 'Builds' }, { kind: 'nav', view: 'builds', label: 'Builds' }, { kind: 'click', label: 'Start build now' }, { kind: 'click', label: 'Start build now' }, { kind: 'nav', view: 'plan' }]);
  assert.equal(steps.length, 4);
  assert.equal(steps[0].title, 'Hook');
  assert.equal(steps[1].do, 'nav:builds');
  assert.equal(steps[2].target, 'text=Start build now');
  assert.equal(steps[3].do, 'nav:plan');
  assert.deepEqual(E.stepsFromRecording([]), []);
});

ok('settings normalise, merge and flatten; bad values fall back or clamp', () => {
  const s = E.normalizeSettings({ music: { volume: 400, mood: 'loud' }, stage: { maxZoom: 9 }, script: { minutes: 0 }, junk: 1 });
  assert.equal(s.music.volume, 100); assert.equal(s.music.mood, 'calm'); assert.equal(s.stage.maxZoom, 2.5); assert.equal(s.script.minutes, 1, 'clamped to the floor');
  assert.equal(E.normalizeSettings({ script: { minutes: 'two' } }).script.minutes, 2, 'not a number: the default');
  assert.equal(E.mergeSettings(s, { music: { on: false } }).music.on, false);
  assert.ok(E.flattenSettings(s).some((r) => r.key === 'export.format'));
  assert.deepEqual(E.settingFromText('music.on', 'off'), { music: { on: false } });
  assert.throws(() => E.settingFromText('nope.x', '1'));
});

ok('topics from the live search index merge under the registry; search ranks labels first', () => {
  const live = E.topicsFromSearch([{ id: 'view:home', kind: 'view', label: 'Home', focus: { kind: 'view', view: 'home' } }, { id: 'view:sample', kind: 'view', label: 'Sample', focus: { kind: 'view', view: 'sample' } }, { id: 'd', kind: 'dialog', label: 'Plugin switches', focus: { kind: 'dialog', id: 'plugin-switches' } }]);
  assert.equal(live.length, 3);
  const merged = E.mergeTopics([topic], live);
  assert.ok(!merged.some((t) => t.id === 'screen:sample'), 'a plugin screen is pitched as part of its plugin');
  assert.ok(merged.some((t) => t.id === 'screen:home') && merged.some((t) => t.id === 'dialog:plugin-switches'));
  assert.equal(E.searchTopics(merged, 'home')[0].id, 'screen:home');
  // boilerplate settings rows every plugin repeats are not topics; the featured list is plugins and screens only
  const boiler = E.topicsFromSearch([{ id: 'a', kind: 'setting', label: 'About', focus: { kind: 'setting', tab: 'x' } }, { id: 'b', kind: 'setting', label: 'About', focus: { kind: 'setting', tab: 'y' } }, { id: 'c', kind: 'setting', label: 'Music volume', focus: { kind: 'setting', tab: 'z' } }]);
  assert.deepEqual(boiler.map((t) => t.label), ['Music volume']);
  const featured = E.featuredTopics(merged, 8);
  assert.ok(featured.length >= 2 && featured[0].id === 'plugin:sample' && featured.every((t) => t.kind === 'plugin' || t.kind === 'screen'));
});

ok('deep links', () => {
  assert.equal(E.shareLink('https://c.example', 'pitch-x-2m', { play: true }), 'https://c.example/?axf-demo=pitch-x-2m&axf-autoplay=1');
  assert.deepEqual(E.parseDeepLink('?axf-demo=pitch-x-2m&axf-autoplay=1'), { id: 'pitch-x-2m', play: true });
  assert.equal(E.parseDeepLink('?x=1'), null);
});

ok('music plans exist for every mood', () => { for (const m of E.MOODS) { const p = E.musicPlan(m); assert.ok(p.bpm > 0 && p.chords.length >= 4); } });

/* ---------------- registry (the real repo) ---------------- */

const topics = Reg.allTopics();
ok('the registry lists every console plugin with a view and the console’s own screens, with words to pitch from', () => {
  assert.ok(topics.length > 60, `${topics.length} topics`);
  const ui = topics.find((t) => t.id === 'plugin:ui-review');
  assert.ok(ui && ui.screens.length >= 1 && ui.description.length > 50);
  assert.ok(ui.screens.some((s) => s.controls.length > 0), 'controls from help.json');
  assert.ok(topics.find((t) => t.id === 'screen:home'));
  assert.ok(topics.find((t) => t.id === 'plugin:demonstration-designer'));
  for (const t of topics) assert.ok(t.id && t.label && E.TOPIC_KINDS.includes(t.kind), t.id);
});

ok('every registry topic yields a valid pitch at 1 and 3 minutes', () => {
  for (const t of topics) for (const minutes of [1, 3]) {
    const p = E.generatePitch(t, { minutes });
    assert.deepEqual(R.demoAssetErrors('demonstration', p.data), [], `${t.id} @${minutes}`);
    assert.ok(p.data.steps.length >= 2 && p.data.steps.length <= 60);
  }
});

/* ---------------- store + CLI (scratch data folder) ---------------- */

ok('generate --save stores a demonstration@1 asset with its pitch facts; list and get see it', () => {
  const r = cli('generate', 'plugin:ui-review', '--minutes', '2', '--save', '--json');
  assert.equal(r.status, 0, r.stderr);
  const a = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(a.$axf, 'asset@1'); assert.equal(a.type, 'demonstration'); assert.equal(a.id, 'pitch-ui-review-2m');
  assert.equal(a.pitch.minutes, 2);
  assert.ok(existsSync(join(scratch, 'demonstration', 'pitch-ui-review-2m.json')) && existsSync(join(scratch, 'pitch', 'pitch-ui-review-2m.json')));
  assert.equal(S.list()[0].id, 'pitch-ui-review-2m');
  assert.equal(S.get('pitch-ui-review-2m').pitch.topic, 'plugin:ui-review');
});

ok('a second demo chains after the first into a tour; the walkthrough carries both', () => {
  S.generate('screen:home', { minutes: 1, save: true });
  S.setChain('pitch-ui-review-2m', ['pitch-home-1m']);
  const w = S.walkthrough('pitch-ui-review-2m');
  assert.equal(w.$axf, 'walkthrough@1');
  assert.deepEqual(w.parts, ['pitch-ui-review-2m', 'pitch-home-1m']);
  assert.ok(w.steps.length === S.get('pitch-ui-review-2m').data.steps.length + S.get('pitch-home-1m').data.steps.length);
  assert.throws(() => S.setChain('pitch-ui-review-2m', ['pitch-ui-review-2m']));
  assert.throws(() => S.setChain('pitch-ui-review-2m', ['nope']));
});

ok('the script is applied from text through the CLI', () => {
  const f = join(scratch, 'script.txt');
  writeFileSync(f, `${S.script('pitch-home-1m').replace('Meet Home.', 'This is Home.')}`);
  const r = cli('script', 'pitch-home-1m', '--text', f, '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(S.get('pitch-home-1m').data.steps[0].say.startsWith('This is Home.'));
});

ok('save refuses a bad asset and a bad id', () => {
  assert.throws(() => S.save({ id: 'x', name: 'x', data: { steps: [] } }), /needs 1 to 60 steps|not a demo id/);
  assert.throws(() => S.save({ id: 'ok-demo', name: 'ok', data: { steps: [{ say: 'hi', do: 'javascript:alert(1)' }] } }), /console action/);
});

ok('a recording becomes a clip@1 with a transcript and a large keyword set; media list sees it; pruning keeps the newest', () => {
  const f = join(scratch, 'rec.webm'); writeFileSync(f, 'not a real video');
  const r = S.addMedia('pitch-ui-review-2m', f, { seconds: 95, mime: 'video/webm' });
  assert.equal(r.clip.type, 'clip');
  assert.deepEqual(R.demoAssetErrors('clip', r.clip.data), []);
  assert.equal(r.clip.data.source.id, 'pitch-ui-review-2m');
  assert.ok(r.clip.data.transcript.length >= 5 && r.clip.data.keywords.length > 40);
  assert.ok(existsSync(r.file));
  assert.equal(S.listMedia().length, 1);
  S.saveSettings({ export: { keep: 1 } });
  S.addMedia('pitch-ui-review-2m', f, { seconds: 10, mime: 'video/webm' });
  assert.equal(S.listMedia().length, 1, 'older recording pruned');
  assert.throws(() => S.exportMp4('nope-clip'), /no clip/);
});

ok('settings through the CLI: set, read back, clamped', () => {
  const r = cli('settings', 'set', 'music.volume', '250', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).music.volume, 100);
  assert.equal(S.settings().music.volume, 100);
  assert.equal(cli('settings', 'set', 'nope.x', '1').status, 1);
});

ok('share answers the deep link; delete removes the demo and its facts', () => {
  assert.equal(S.share('pitch-home-1m', 'https://c.example').url, 'https://c.example/?axf-demo=pitch-home-1m');
  assert.equal(S.remove('pitch-home-1m'), true);
  assert.equal(S.get('pitch-home-1m'), null);
  assert.equal(S.remove('pitch-home-1m'), false);
});

ok('topics through the CLI', () => {
  const r = cli('topics', '--kind', 'plugin', '--q', 'review', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).some((t) => t.id === 'plugin:ui-review'));
});

/* ---------------- manifest ---------------- */

ok('plugin.json declares every server route as a command with a description, and the lifecycle data folder', () => {
  const pj = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8'));
  const src = readFileSync(join(HERE, 'server/__init__.py'), 'utf8');
  const routes = [...src.matchAll(/@router\.(get|post|delete)\("([^"]+)"/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`);
  const declared = new Set(pj.commands.items.map((c) => c.route));
  for (const r of routes) assert.ok(declared.has(r), `route ${r} is not declared`);
  for (const c of pj.commands.items) assert.ok(c.description && c.title, c.id);
  assert.equal(pj.lifecycle.dataDir, '.axf-console/plugins/demonstration-designer');
  assert.ok(pj.provides.includes('service:demonstrations@1'));
  const help = JSON.parse(readFileSync(join(HERE, 'help.json'), 'utf8'));
  assert.ok(help.data.entries.some((e) => e.target === 'view:demonstration-designer' && e.kind === 'screen'));
});


/* ---------------- pipeline demos (pipeline-demo@1): library, timeline, player, panel filter, voice, store, live ---------------- */
{
  const PL = await import('./pipelines.mjs');
  const { LIBRARY } = await import('./pipeline-library.mjs');
  const PS = await import('./pipeline-demos.mjs');
  const pcli = (...args) => spawnSync('node', [join(HERE, 'pipeline-demos.mjs'), ...args], { encoding: 'utf8', env: { ...process.env } });

  ok('the library ships one demo per pipeline type, each valid, with screens and behind-the-scenes lines of several kinds', () => {
    for (const t of PL.TYPE_IDS.filter((x) => x !== 'custom')) assert.ok(LIBRARY.some((d) => d.type === t), t);
    for (const d of LIBRARY) {
      assert.deepEqual(PL.validateDemo(d), [], d.id);
      assert.ok(d.builtIn && d.chapters.length >= 3 && d.chapters.every((c) => c.say && c.view), d.id);
      const kinds = new Set(d.chapters.flatMap((c) => c.events.map((e) => e.kind)));
      assert.ok(kinds.size >= 3, `${d.id}: ${[...kinds]}`);
      for (const c of d.chapters) for (const p of c.live) assert.ok(PL.PROBES[p], `${d.id}/${c.id}: probe ${p}`);
    }
    const screens = new Set(LIBRARY.flatMap((d) => d.chapters.map((c) => c.view)));
    for (const v of ['build-orchestrator', 'builds', 'ui-review', 'shipped-features']) assert.ok(screens.has(v), v);
  });

  ok('timeline: chapters back to back, a focus line at each screen, lines sorted by second', () => {
    const tl = PL.timeline(LIBRARY[0]);
    assert.equal(tl.chapters[0].start, 0);
    for (let i = 1; i < tl.chapters.length; i++) assert.equal(tl.chapters[i].start, tl.chapters[i - 1].end);
    assert.equal(tl.total, tl.chapters.at(-1).end);
    assert.equal(tl.events.filter((e) => e.kind === 'focus').length, tl.chapters.filter((c) => c.view).length);
    for (let i = 1; i < tl.events.length; i++) assert.ok(tl.events[i].t >= tl.events[i - 1].t);
    assert.equal(PL.chapterAt(tl, tl.chapters[2].start + 0.1), 2);
  });

  ok('player: play, tick at speed, pause holds, skip and back by chapter, restart, done at the end', () => {
    const tl = PL.timeline(LIBRARY[0]);
    let s = PL.playerReduce(PL.playerInit(), { type: 'play' }, tl);
    assert.equal(s.status, 'playing');
    s = PL.playerReduce(PL.playerReduce(s, { type: 'speed', speed: 2 }, tl), { type: 'tick', dt: 1.5 }, tl);
    assert.equal(s.at, 3);
    s = PL.playerReduce(s, { type: 'pause' }, tl);
    assert.equal(PL.playerReduce(s, { type: 'tick', dt: 5 }, tl).at, 3);
    s = PL.playerReduce(s, { type: 'next' }, tl);
    assert.equal(s.at, tl.chapters[1].start);
    s = PL.playerReduce(s, { type: 'prev' }, tl);
    assert.equal(s.at, 0);
    s = PL.playerReduce(PL.playerReduce(PL.playerReduce(s, { type: 'resume' }, tl), { type: 'seek', at: tl.total - 1 }, tl), { type: 'tick', dt: 5 }, tl);
    assert.equal(s.status, 'done'); assert.equal(s.at, tl.total);
    s = PL.playerReduce(s, { type: 'restart' }, tl);
    assert.equal(s.at, 0); assert.equal(s.status, 'playing');
    assert.equal(PL.playerReduce(s, { type: 'dock', dock: 'full' }, tl).dock, 'full');
    assert.equal(PL.playerReduce(s, { type: 'dock', dock: 'sideways' }, tl).dock, 'dock');
  });

  ok('the panel filter keeps the kinds asked for and every word; lines print as clock, kind, text', () => {
    const tl = PL.timeline(LIBRARY.find((d) => d.id === 'parallel-split'));
    const git = PL.filterEvents(tl.events, { kinds: ['git'] });
    assert.ok(git.length >= 3 && git.every((e) => e.kind === 'git'));
    assert.ok(PL.filterEvents(tl.events, { q: 'slot 2 push' }).every((e) => /slot 2/.test(e.text) && /push/.test(e.text)));
    assert.match(PL.lineText(git[0]), /^\d\d:\d\d git {10}/);
  });

  ok('voice: "run the voice-to-app demo" and other phrases name the right demo', () => {
    assert.equal(PL.matchDemo('run the voice-to-app demo', LIBRARY), 'voice-to-app');
    assert.equal(PL.matchDemo('show me the skin swap', LIBRARY), 'skin-swap');
    assert.equal(PL.matchDemo('approve by voice', LIBRARY), 'approval-flow');
    assert.equal(PL.matchDemo('fix a failing build', LIBRARY), 'auto-fix');
    assert.equal(PL.matchDemo('parallel split build', LIBRARY), 'parallel-split');
    assert.equal(PL.matchDemo('the demo', LIBRARY), '');
  });

  ok('deep link: ?axf-pipeline=<id> with autoplay and live round trip; library opens the list', () => {
    const l = PL.pipelineLink('', 'skin-swap', { play: true, mode: 'live' });
    assert.deepEqual(PL.parsePipelineLink(l.slice(1)), { id: 'skin-swap', play: true, mode: 'live' });
    assert.equal(PL.parsePipelineLink('?axf-pipeline=library').id, 'library');
    assert.equal(PL.parsePipelineLink('?axf-pipeline=../x'), null);
  });

  ok('designer store: save, copy a built-in (it stays), a saved copy shadows it, built-ins cannot be deleted', () => {
    assert.throws(() => PS.save({ name: '', chapters: [] }), /name/);
    const mine = PS.save({ id: 'my-pipe', name: 'My pipe', type: 'custom', chapters: [{ title: 'One', say: 'Hello there everyone.', view: 'builds', events: [{ at: 1, kind: 'git', text: 'push' }] }] });
    assert.equal(mine.builtIn, false);
    assert.ok(PS.list().some((s) => s.id === 'my-pipe' && !s.builtIn));
    const c = PS.copy('skin-swap');
    assert.equal(c.id, 'skin-swap-copy');
    assert.ok(PS.get('skin-swap').builtIn);
    PS.save({ ...PS.get('skin-swap'), name: 'Skin swap, my way' });
    assert.equal(PS.get('skin-swap').name, 'Skin swap, my way');
    assert.equal(PS.remove('skin-swap'), true);
    assert.ok(PS.get('skin-swap').builtIn);
    assert.throws(() => PS.remove('skin-swap'), /built-in/);
    assert.equal(PS.remove('my-pipe'), true);
  });

  if (!process.env.AXF_DEMO_DESIGNER_PROBE) {
    const r = await PS.live('add-feature', { chapter: 'ask' });
    const probes = await PS.probe('model-pick', { say: 'Write the data model and the schema for it. Then add a button to the list.' });
    ok('live run: the chapter probes run for real on the test-sandbox data and the recording is what the next replay plays', () => {
    assert.equal(r.$axf, 'pipeline-recording@1');
    assert.ok(r.live >= 1, 'at least one real line');
    const played = PS.playable('add-feature');
    assert.ok(played.recordedAt);
    assert.ok(played.timeline.events.some((e) => e.source === 'sandbox-builds'));
    assert.ok(!PS.playable('add-feature', { recorded: false }).timeline.events.some((e) => e.source));
    assert.match(probes[0], /→ fable/); assert.match(probes[1], /→ opus/);
    });
  }

  ok('pipeline CLI: list, lines filtered, match, link, timeline at speed', () => {
    const l = pcli('list', '--json'); assert.equal(l.status, 0, l.stderr);
    assert.ok(JSON.parse(l.stdout).length >= 7);
    const g = pcli('lines', 'parallel-split', '--kind', 'git', '--json'); assert.equal(g.status, 0, g.stderr);
    assert.ok(JSON.parse(g.stdout).every((e) => e.kind === 'git'));
    const m = pcli('match', 'run', 'the', 'voice-to-app', 'demo', '--json'); assert.equal(JSON.parse(m.stdout).id, 'voice-to-app');
    assert.equal(pcli('match', 'nothing', 'like', 'this').status, 2);
    assert.match(JSON.parse(pcli('link', 'auto-fix', '--play', '--json').stdout).path, /axf-pipeline=auto-fix&axf-autoplay=1/);
    const t = JSON.parse(pcli('timeline', 'auto-fix', '--speed', '2', '--json').stdout);
    assert.equal(t.wallSeconds, t.timeline.total / 2);
    assert.equal(pcli('get', 'no-such-demo').status, 2);
  });
}

/* ---------------- server: cloud narrator routes (python3 + fastapi, when there) ---------------- */
{
  const py = process.env.PYTHON || 'python3';
  const has = spawnSync(py, ['-c', 'import fastapi, httpx'], { encoding: 'utf8' });
  if (has.status === 0) {
    ok('the cloud narrator routes over axf.speech@1 (server_test.py)', () => {
      const r = spawnSync(py, [join(HERE, 'server_test.py')], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    });
  } else console.log('  - server_test.py skipped: python3 with fastapi is not here');
}

console.log(`demonstration-designer: ${n} checks passed`);
