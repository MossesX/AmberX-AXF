// @ts-nocheck: a Node test, not part of the console's build
// Self-test for the API Browser's pure part: node --experimental-strip-types apps/console-web/plugins/api-browser/test.mts
import assert from 'node:assert/strict';
import * as c from './web/core.ts';

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n += 1; console.log(`  ✓ ${name}`); };
const E = (o: Partial<c.Entry>): c.Entry => ({ id: 'x', group: 'control', area: 'console', title: 'X', doc: '', effect: 'read', policy: 'instant', input: { type: 'object' }, rest: null, mcp: [], cli: '', ...o });
const setVal = E({ id: 'control/console.values/set', target: 'console.values', op: 'set', title: 'set · Console setting values', effect: 'write', policy: 'veto',
  input: { type: 'object', properties: { op: { const: 'set' }, target: { const: 'console.values' }, path: { type: 'string' }, value: { description: 'v' }, reason: { type: 'string' } }, required: ['op', 'target', 'path', 'value'] },
  rest: { method: 'POST', path: '/api/control', body: { op: 'set', target: 'console.values' } }, mcp: ['control_set', 'console_value'], cli: 'axf control set console.values <path> <value>' });
const typeCmd = E({ id: 'plugins/console-terminal/type', group: 'plugins', area: 'console-terminal', plugin: 'console-terminal', command: 'type', title: 'Type into a Terminal tab', effect: 'write', policy: 'veto',
  input: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, enter: { type: 'boolean' } }, required: ['id', 'text'] }, rest: { method: 'POST', path: '/api/control/console-terminal/type' }, mcp: ['console-terminal_type'], cli: 'axf console-terminal type' });
const tabs = E({ id: 'plugins/console-terminal/tabs', group: 'plugins', area: 'console-terminal', plugin: 'console-terminal', command: 'tabs', title: 'List tabs', mcp: ['console-terminal_tabs'] });
const decide = E({ id: 'plugins/approvals-banner/~POST /decide', group: 'plugins', plugin: 'approvals-banner', title: 'POST /decide', effect: 'person', policy: 'person', skipped: true, doc: "a person's tap only" });
const mcpOnly = E({ id: 'mcp/build_next', group: 'mcp', area: 'build', title: 'build_next', mcp: ['build_next'] });
const restGet = E({ id: 'rest/GET /api/builds/{id}', group: 'rest', title: 'GET /api/builds/{id}', rest: { method: 'GET', path: '/api/builds/{id}' } });
const cli = E({ id: 'cli/validate', group: 'cli', title: 'axf validate', cli: 'axf validate', local: true });
const all = [setVal, typeCmd, tabs, decide, mcpOnly, restGet, cli];

t('search matches every word across id, title, doc and names', () => {
  assert.deepEqual(c.filterEntries(all, 'terminal type').map((e) => e.id), ['plugins/console-terminal/type']);
  assert.deepEqual(c.filterEntries(all, 'console_value').map((e) => e.id), ['control/console.values/set']);
  assert.equal(c.filterEntries(all, '', { group: 'plugins' }).length, 3);
  assert.deepEqual(c.filterEntries(all, '', { policy: 'person' }).map((e) => e.id), [decide.id]);
});
t('the tree is app › area › group', () => {
  const tr = c.treeOf(all);
  assert.equal(tr[0].label, 'Dev Console');
  const term = tr[0].areas.find((a) => a.id === 'plugin:console-terminal');
  assert.equal(term?.groups[0].entries.length, 2);
  assert.ok(tr[0].areas.some((a) => a.label === 'control@1 · console'));
});
t('a sample body: what is required and fixed (control commands drop reason / by, optional fields keep their defaults)', () => {
  assert.deepEqual(c.sampleBody(setVal), { op: 'set', target: 'console.values', path: '', value: '' });
  assert.deepEqual(c.sampleBody(typeCmd), { id: '', text: '' }); // optional fields keep their defaults
});
t('Try it: control and plugin commands go to POST /api/control as one command', () => {
  const r1 = c.tryRequest(setVal, { op: 'set', target: 'console.values', path: 'axf.display.compact', value: true }) as c.TryRequest;
  assert.equal(r1.url, '/api/control'); assert.equal((r1.body as { value: boolean }).value, true);
  const r2 = c.tryRequest(typeCmd, { id: 't1', text: 'ls' }, 'tok') as c.TryRequest;
  assert.deepEqual(r2.body, { $axf: 'control@1', op: 'act', target: 'plugins.commands', path: 'console-terminal/type', action: 'run', input: { id: 't1', text: 'ls' }, confirm: 'tok', by: 'api-browser' });
  const r3 = c.tryRequest(tabs, {}) as c.TryRequest;
  assert.equal((r3.body as { target: string; action: string }).target, 'plugins.reads');
});
t('Try it: REST fills path parameters; MCP-only, CLI and Brett-only paths say why they cannot run here', () => {
  assert.equal((c.tryRequest(restGet, { id: 'b1' }) as c.TryRequest).url, '/api/builds/b1');
  assert.ok('why' in c.tryRequest(restGet, {}));
  assert.match((c.tryRequest(mcpOnly, {}) as { why: string }).why, /Claude session/);
  assert.match((c.tryRequest(cli, {}) as { why: string }).why, /axf validate/);
  assert.match((c.tryRequest(decide, {}) as { why: string }).why, /Brett/);
});
t('only instant paths run without a yes', () => {
  assert.equal(c.needsYes(tabs), false);
  assert.equal(c.needsYes(setVal), true);
});
t('coverage filters and counts', () => {
  const rows: c.CoverageRow[] = [
    { kind: 'control', id: 'Button:Save', label: 'Save', where: 'plugin:x', file: 'a', api: 'console.elements press x/button:Save', status: 'generic' },
    { kind: 'control', id: 'button:?', label: '', where: 'plugin:x', file: 'a', api: '', status: 'gap', fix: 'name it' },
    { kind: 'action', id: 'x.go', label: 'x.go', where: 'plugin:x', file: 'a', api: 'console.actions run x.go', status: 'covered' },
  ];
  assert.equal(c.filterCoverage(rows, '', 'gap').length, 1);
  assert.equal(c.filterCoverage(rows, 'save').length, 1);
  assert.deepEqual(c.coverageCounts(rows), { covered: 1, generic: 1, 'person-only': 0, skipped: 0, gap: 1 });
});
console.log(`✓ api-browser — ${n} checks`);
