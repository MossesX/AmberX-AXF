/**
 * library-config@1 + library-instance@1 (the no-code library import wizard contract, library-harvest addendum 1):
 *   1. every shipped library (framework/libs/*, python/axf_libs/*, android lib-*) derives a valid manifest
 *   2. the fixture replays: derivation, wizard steps, answers → instance, errors, reconfigure, status, install config
 *   3. the registry snapshot (schemas/library-config.json) and the JSON Schemas (schemas/json/library-config.schema.json,
 *      library-instance.schema.json) match core/library-config.mjs
 *   4. credentials never carry a value, anywhere
 *
 *   npx -y tsx framework/spec/check-library-config.mts            check
 *   npx -y tsx framework/spec/check-library-config.mts --write    rewrite the fixture + snapshots from the engine
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../core/library-config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(ROOT, 'framework/spec/fixtures/library-config.json');
const WRITE = process.argv.includes('--write');
let okN = 0, fail = 0;
const ok = (c: unknown, msg: string) => { if (c) okN++; else { fail++; console.log(`✗ ${msg}`); } };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const rd = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const NOW = '2026-11-07T04:00:00.000Z';
const LATER = '2026-11-07T05:00:00.000Z';

// A library@1 record with every kind of thing the wizard asks for.
const SAMPLE_LIB = {
  $axf: 'library@1', id: 'ai.amberx.axf.sample', module: 'lib-sample', version: '1.2.0', name: 'Sample feed', description: 'Shows a feed of rows from a data set.',
  dependsOn: ['ai.amberx.axf.datagrid'], provides: ['axf.sample@1'], manifestKey: 'libraries.sample',
  params: [
    { key: 'pageSize', label: 'Rows per page', type: 'number', default: 25, min: 5, max: 200 },
    { key: 'apiToken', label: 'API token', type: 'text', required: true, help: 'The feed server token.' },
  ],
  parts: [
    { id: 'feed', label: 'Feed view', description: 'The list itself.', params: [{ key: 'title', label: 'Title', type: 'text', default: 'Feed' }] },
    { id: 'filters', label: 'Filters', requires: ['feed'], default: false },
    { id: 'export', label: 'Export', params: [{ key: 'format', label: 'Format', type: 'choice', choices: ['csv', 'json'], default: 'csv' }] },
  ],
  ports: { web: { status: 'compiled', dir: 'libs/sample' } },
  placeholders: [{ capability: 'axf.sample.android', note: 'Compose port — Android on hold.' }],
  config: {
    connections: [
      { id: 'rows', label: 'Rows', kind: 'dataset', direction: 'in', required: true, accepts: ['dataset'], description: 'Where the rows come from.' },
      { id: 'picked', label: 'Picked row', kind: 'action', direction: 'out' },
      { id: 'filter-ui', label: 'Filter UI', kind: 'registry-ui', direction: 'in', forCapability: 'filters', many: true },
    ],
    credentials: [{ key: 'hubKey', label: 'Hub key', required: false, env: 'AXF_SAMPLE_HUB_KEY' }],
    wizard: { mode: 'assisted', intro: 'Let us set the feed up.' },
  },
};

function build() {
  const m = L.manifestFrom(SAMPLE_LIB);
  const steps = L.wizardSteps(m);
  const d0 = L.newDraft(m);
  const a1 = L.answerStep(m, d0, 'capabilities', { filters: true, export: { format: 'json' } });
  const a2 = L.answerStep(m, a1.draft, 'connections', { rows: 'dataset:changes', picked: 'action:changes.open', 'filter-ui': ['ui:basic-filter', 'ui:saved-filters'] });
  const a3 = L.answerStep(m, a2.draft, 'settings', { pageSize: '50' });
  const a4 = L.answerStep(m, a3.draft, 'credentials', { apiToken: 'env:SAMPLE_TOKEN' });
  const errorsBeforeCreds = L.draftErrors(m, a3.draft);
  const inst = L.instanceFrom(m, a4.draft, { now: NOW, app: 'console-web', by: 'amber', surface: 'cli' });
  const bad = {
    capabilities: L.answerStep(m, d0, 'capabilities', { nope: true, export: { format: 'xml' } }).errors,
    connections: L.answerStep(m, d0, 'connections', { rows: 'ui:wrong', picked: ['action:a', 'action:b'] }).errors,
    settings: L.answerStep(m, d0, 'settings', { pageSize: '1000', ghost: 1 }).errors,
    credentials: L.answerStep(m, d0, 'credentials', { apiToken: { value: 'sk-live-123' } }).errors.concat(L.answerStep(m, d0, 'credentials', { apiToken: 'sk-live-123' }).errors),
    step: L.answerStep(m, d0, 'bogus', {}).errors,
  };
  const re = L.reconfigure(m, inst, L.answerStep(m, L.draftFromInstance(m, inst), 'capabilities', { filters: false }).draft, { now: LATER, by: 'amber' });
  const disabled = L.setStatus(re, 'disabled', { now: LATER, by: 'amber' });
  const removed = L.setStatus(disabled, 'removed', { now: LATER, by: 'amber' });
  const brokenManifest = L.manifestErrors({ ...m, library: 'Nope', capabilities: [...m.capabilities, { id: 'feed', label: 'dup', requires: ['ghost'] }], credentials: [...m.credentials, { key: 'k', label: 'K', value: 'x' }] });
  return {
    $axf: 'library-config-fixture@1', reference: 'framework/core/library-config.mjs (Kotlin twin deferred: Android on hold)',
    sampleLibrary: SAMPLE_LIB, manifest: m, steps, draft: d0,
    answers: { capabilities: a1, connections: a2, settings: a3, credentials: a4 }, errorsBeforeCredentials: errorsBeforeCreds,
    instance: inst, instanceErrors: L.instanceErrors(m, inst), summary: L.instanceSummary(m, inst), installConfig: L.installConfig(m, inst),
    draftFromInstance: L.draftFromInstance(m, inst), reconfigured: re, disabled, removed, badAnswers: bad, brokenManifest,
    registry: L.REGISTRY,
  };
}

const built = build();
if (WRITE) {
  writeFileSync(FIXTURE, `${JSON.stringify(built, null, 1)}\n`);
  writeFileSync(join(ROOT, 'framework/schemas/library-config.json'), `${JSON.stringify(L.REGISTRY, null, 2)}\n`);
  for (const [n, s] of Object.entries(L.jsonSchemas())) writeFileSync(join(ROOT, 'framework/schemas/json', n), `${JSON.stringify(s, null, 2)}\n`);
  console.log('wrote fixture + snapshots');
}

// 1. every shipped library derives a valid manifest
const libDirs = ['framework/libs', 'framework/python/axf_libs', 'framework/android'].map((d) => join(ROOT, d)).filter(existsSync);
let libs = 0;
for (const root of libDirs) for (const d of readdirSync(root)) {
  const f = join(root, d, 'library.json'); if (!existsSync(f)) continue; libs++;
  const lib = JSON.parse(readFileSync(f, 'utf8'));
  const m = L.manifestFrom(lib); const e = L.manifestErrors(m);
  ok(!e.length, `${d}: ${e.join('; ')}`);
  ok(m.wizard.steps[0] === 'about' && m.wizard.steps.at(-1) === 'review', `${d}: wizard starts with about and ends with review`);
  const inst = L.instanceFrom(m, null, { now: NOW, app: 'x' });
  ok(!L.instanceErrors(m, inst).length || L.draftErrors(m, null).length > 0, `${d}: a default instance is valid (or says what is missing)`);
  ok(same(L.draftFromInstance(m, inst).capabilities, L.newDraft(m).capabilities), `${d}: draft → instance → draft keeps the capabilities`);
}
ok(libs >= 20, `found ${libs} libraries`);

// 2. fixture replay
const fx = rd('framework/spec/fixtures/library-config.json');
for (const k of ['manifest', 'steps', 'draft', 'answers', 'errorsBeforeCredentials', 'instance', 'instanceErrors', 'summary', 'installConfig', 'draftFromInstance', 'reconfigured', 'disabled', 'removed', 'badAnswers', 'brokenManifest', 'registry']) {
  ok(same(fx[k], (built as Record<string, unknown>)[k]), `fixture ${k} matches the engine (run with --write after a deliberate change)`);
}
ok(same(fx.manifest.wizard.steps, ['about', 'capabilities', 'connections', 'settings', 'credentials', 'review']), 'the sample asks every step');
ok(fx.manifest.credentials.map((c: { key: string }) => c.key).join() === 'apiToken,hubKey', 'secret params become credentials, config credentials follow');
ok(fx.manifest.settings.map((p: { key: string }) => p.key).join() === 'pageSize', 'non-secret params are settings');
ok(fx.answers.capabilities.draft.capabilities.feed !== false && fx.answers.capabilities.draft.capabilities.filters !== false, 'turning filters on keeps feed (requires)');
ok(fx.errorsBeforeCredentials.length === 1 && /API token/.test(fx.errorsBeforeCredentials[0]), 'a missing required credential blocks apply');
ok(fx.instance.capabilities.join() === 'feed,filters,export', 'instance lists the on capabilities in manifest order');
ok(fx.instance.credentials.apiToken.ref === 'env:SAMPLE_TOKEN' && !('value' in fx.instance.credentials.apiToken), 'credentials are references');
ok(fx.instance.params.pageSize === 50, 'settings are coerced to their type');
ok(fx.installConfig.parts.export.format === 'json' && fx.installConfig.parts.feed.title === 'Feed' && fx.installConfig.instance === fx.instance.id, 'install config = parts with params + instance id');
ok(fx.reconfigured.capabilities.join() === 'feed,export' && fx.reconfigured.history.length === 2 && fx.reconfigured.createdAt === NOW && fx.reconfigured.updatedAt === LATER, 'reconfigure keeps id, createdAt, history');
ok(fx.disabled.status === 'disabled' && fx.removed.status === 'removed' && fx.removed.history.at(-1).kind === 'removed', 'disable then remove are recorded, nothing deleted');
ok(fx.badAnswers.credentials.length === 2 && fx.badAnswers.credentials.every((e: string) => /reference/.test(e)), 'a credential value is refused both ways');
ok(fx.badAnswers.connections.length === 2, 'wrong prefix and too many refs are refused');
ok(fx.badAnswers.capabilities.length === 2 && fx.badAnswers.settings.length === 2 && fx.badAnswers.step.length === 1, 'unknown ids, bad choices and ranges are named');
ok(fx.brokenManifest.length >= 4, `a broken manifest names every problem (${fx.brokenManifest.length})`);
ok(fx.summary[0].startsWith('Sample feed 1.2.0 in console-web') && fx.summary.some((l: string) => l.startsWith('Credentials: ') && l.includes('env:SAMPLE_TOKEN')), 'summary reads back in words, refs not values');

// 3. snapshots
ok(same(rd('framework/schemas/library-config.json'), L.REGISTRY), 'schemas/library-config.json matches REGISTRY (--write)');
for (const [n, s] of Object.entries(L.jsonSchemas())) ok(same(rd(`framework/schemas/json/${n}`), s), `schemas/json/${n} is current (--write)`);

// 4. no value ever: instance JSON never carries a credential value key
const text = JSON.stringify(fx.instance.credentials);
ok(!/"(value|token|password|secret)"/.test(text), 'instance credentials carry only refs');

console.log(`library-config: ${okN} ok, ${fail} failed`);
if (fail) process.exit(1);
