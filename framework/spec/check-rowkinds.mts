// @ts-nocheck: a Node test, not part of an app build
/**
 * grid-row@1 (framework/libs/datagrid/rowkinds.ts): the row-kind registry behind every grid's expandable row, Related
 * links and row commands. Pure store, no React. npx -y tsx framework/spec/check-rowkinds.mts
 */
import assert from 'node:assert/strict';
import {
  actionCommand, allRowCommands, autoRelated, clearOwnerRowKinds, commandsFor, encodeRowIds, extendRowKind, fieldText, fieldsFor,
  isSecretField, noteRecord, onRowsChanged, parseRowIds, recordFields, recordFor, registerRowKind, relatedFor, relatedLabel,
  rowCommandAction, rowKind, runRowCommand, setGridSelection, targetIds,
} from '../libs/datagrid/rowkinds.ts';

let n = 0;
const t = async (name: string, f: () => void | Promise<void>) => { try { await f(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

const ran: string[][] = [];
const off = registerRowKind({
  kind: 'build', label: 'Build', owner: 'test', aliases: ['orchestrator'],
  title: (r) => r.title,
  related: (r) => (r.pendingId ? [{ kind: 'pending', id: r.pendingId, note: 'filed as' }] : []),
  commands: [
    { id: 'hold', label: 'Hold', multi: true, when: (r) => r.status !== 'deleted', run: ({ ids }) => { ran.push(['hold', ...ids]); } },
    { id: 'open', label: 'Open', effect: 'navigate', button: true, run: ({ ids }) => { ran.push(['open', ...ids]); } },
    { id: 'delete', label: 'Delete', multi: true, effect: 'destructive', confirm: 'Delete?', run: ({ ids }) => { ran.push(['delete', ...ids]); } },
    { id: 'boom', label: 'Boom', run: () => { throw new Error('nope'); } },
  ],
});

await t('aliases resolve to the kind', () => {
  assert.equal(rowKind('orchestrator')?.kind, 'build');
  assert.equal(rowKind('nothing'), undefined);
  assert.equal(rowCommandAction('orchestrator', 'hold'), 'row.build.hold');
});

await t('fields: every own field, secrets never drawn', () => {
  const f = recordFields({ id: 'b1', title: 'T', apiKey: 'sk-123', tokensUsed: 5, nested: { token: 'x', ok: 1 }, fn: () => 1 });
  assert.deepEqual(f.map((x) => x.id), ['id', 'title', 'apiKey', 'tokensUsed', 'nested']);
  assert.equal(fieldText('apiKey', 'sk-123'), '••• hidden');
  assert.equal(fieldText('tokensUsed', 5), '5');
  assert.ok(isSecretField('password') && isSecretField('GITHUB_TOKEN') && isSecretField('authorization'));
  assert.ok(!isSecretField('tokensUsed') && !isSecretField('passes'));
  assert.equal(fieldText('nested', { token: 'x', ok: 1 }), '{"token":"••• hidden","ok":1}');
  assert.equal(fieldText('x', ''), '—');
  assert.equal(fieldText('x', ['a', 'b']), 'a, b');
  assert.ok(fieldText('x', 'y'.repeat(900)).endsWith('…'));
  assert.equal(fieldsFor({ kind: 'build', id: 'b1' }, { a: 1 })[0].label, 'A');
});

await t('related: shared fields read as links, PR URLs found, deduplicated, never itself', () => {
  const rec = { id: 'b1', branch: 'claude/x', pr: '#42', build: 'b1', session: 's-9', note: 'see https://github.com/o/r/pull/77', pendingId: 'p1', secretToken: 'build-ish' };
  const auto = autoRelated(rec);
  assert.ok(auto.some((l) => l.kind === 'branch' && l.id === 'claude/x'));
  assert.ok(auto.some((l) => l.kind === 'pr' && l.id === '42'));
  assert.ok(auto.some((l) => l.kind === 'pr' && l.id === '77'));
  assert.ok(auto.some((l) => l.kind === 'session' && l.id === 's-9'));
  const rel = relatedFor({ kind: 'orchestrator', id: 'b1' }, rec);
  assert.equal(rel[0].kind, 'pending', 'the kind\'s own links come first');
  assert.ok(!rel.some((l) => l.kind === 'build' && l.id === 'b1'), 'never links to itself');
  assert.equal(new Set(rel.map((l) => `${l.kind}:${l.id}`)).size, rel.length);
  assert.equal(relatedLabel({ kind: 'pr', id: '42' }), 'PR #42');
  assert.deepEqual(autoRelated({ pr: 'not-a-number' }), []);
});

await t('records: noted by kind (aliases too), titles in labels', () => {
  noteRecord({ kind: 'orchestrator', id: 'b2' }, { id: 'b2', title: 'Second', status: 'deleted' });
  assert.equal(recordFor('build', 'b2').title, 'Second');
  assert.equal(relatedLabel({ kind: 'build', id: 'b2' }), 'Second');
});

await t('commands: when / buttons / multi filters', () => {
  assert.deepEqual(commandsFor({ kind: 'build', id: 'b2' }, recordFor('build', 'b2')).map((c) => c.id), ['open', 'delete', 'boom']);
  assert.deepEqual(commandsFor({ kind: 'build', id: 'b2' }, undefined).map((c) => c.id), ['hold', 'open', 'delete', 'boom'], 'unknown record: offered');
  assert.deepEqual(commandsFor({ kind: 'build', id: 'b2' }, undefined, { buttons: true }).map((c) => c.id), ['open']);
  assert.deepEqual(commandsFor({ kind: 'build', id: 'b2' }, undefined, { multi: true }).map((c) => c.id), ['hold', 'delete']);
  assert.deepEqual(commandsFor({ kind: 'nobody', id: 'x' }, undefined), []);
});

await t('run: multi, skipped by when, single takes one, confirm, errors, rows changed', async () => {
  noteRecord({ kind: 'build', id: 'b1' }, { id: 'b1', status: 'running' });
  let changed = 0; const stop = onRowsChanged('orchestrator', () => { changed++; });
  let r = await runRowCommand('build', 'hold', ['b1', 'b2', 'b3']);
  assert.ok(r.ok); assert.deepEqual(r.ran, ['b1', 'b3']); assert.deepEqual(r.skipped, ['b2']);
  assert.deepEqual(ran.at(-1), ['hold', 'b1', 'b3']);
  assert.equal(changed, 1);
  r = await runRowCommand('build', 'open', ['b1', 'b3']);
  assert.deepEqual(ran.at(-1), ['open', 'b1']); assert.equal(changed, 1, 'navigate changes nothing');
  r = await runRowCommand('build', 'delete', ['b1'], { ask: () => false });
  assert.equal(r.ok, false); assert.equal(r.error, 'Cancelled.');
  let asked = ''; r = await runRowCommand('build', 'delete', ['b1', 'b3'], { ask: (q) => { asked = q; return true; } });
  assert.ok(r.ok); assert.equal(asked, 'Delete? (2 rows)');
  r = await runRowCommand('build', 'boom', ['b1']); assert.equal(r.ok, false); assert.equal(r.error, 'nope');
  r = await runRowCommand('build', 'missing', ['b1']); assert.equal(r.ok, false);
  stop();
});

await t('selection: a command on a selected row runs on the whole selection', () => {
  setGridSelection('grid-a', 'build', ['b1', 'b3']);
  assert.deepEqual(targetIds({ kind: 'build', id: 'b1' }, 'grid-a'), ['b1', 'b3']);
  assert.deepEqual(targetIds({ kind: 'build', id: 'b9' }, 'grid-a'), ['b9'], 'a row outside the selection runs alone');
  assert.deepEqual(targetIds({ kind: 'build', id: 'b1' }, 'grid-b'), ['b1']);
  setGridSelection('grid-a', 'build', []);
  assert.deepEqual(targetIds({ kind: 'build', id: 'b1' }, 'grid-a'), ['b1']);
});

await t('ids on the action wire: comma separated, encoded, colons survive', () => {
  const ids = ['a,b', 'c:d', 'plain'];
  const spec = `row.build.hold:${encodeRowIds(ids)}`;
  const [, ...args] = spec.split(':');
  assert.deepEqual(parseRowIds(args), ids);
  assert.deepEqual(parseRowIds(['x', 'y']), ['x:y']);
});

await t('extend: other modules add commands, even to a kind nobody registered', async () => {
  const unext = extendRowKind('account', { owner: 'other', commands: [{ id: 'switch', label: 'Switch', run: ({ ids }) => { ran.push(['switch', ...ids]); } }] });
  assert.equal(rowKind('account')?.label, 'Account');
  assert.deepEqual(commandsFor({ kind: 'account', id: 'a' }, undefined).map((c) => c.id), ['switch']);
  assert.ok(allRowCommands().some((x) => x.kind.kind === 'account' && x.command.id === 'switch'));
  const r = await runRowCommand('account', 'switch', ['a']); assert.ok(r.ok);
  const ext2 = extendRowKind('build', { owner: 'other', commands: [{ id: 'extra', label: 'Extra', run: () => undefined }] });
  assert.ok(commandsFor({ kind: 'build', id: 'b1' }, undefined).some((c) => c.id === 'extra'));
  ext2(); unext();
  assert.equal(rowKind('account'), undefined);
});

await t('actionCommand: runs the console action per id with the record', async () => {
  const sent: string[] = [];
  registerRowKind({ kind: 'thing', label: 'Thing', owner: 'test2', commands: [actionCommand((s) => sent.push(s), { id: 'go', label: 'Go', multi: true, action: (id, r) => `thing.go:${id}:${r?.n ?? '-'}` })] });
  noteRecord({ kind: 'thing', id: 't1' }, { n: 7 });
  await runRowCommand('thing', 'go', ['t1', 't2']);
  assert.deepEqual(sent, ['thing.go:t1:7', 'thing.go:t2:-']);
  clearOwnerRowKinds('test2');
  assert.equal(rowKind('thing'), undefined);
});

await t('unregister removes the kind and its aliases', () => {
  off();
  assert.equal(rowKind('build'), undefined); assert.equal(rowKind('orchestrator'), undefined);
});

console.log(`✓ grid-row@1 row kinds: ${n} checks`);
