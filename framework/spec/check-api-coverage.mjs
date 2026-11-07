#!/usr/bin/env node
/**
 * api-coverage@1 scanner (framework/cli/api-coverage.mjs, build full-api-control): what it finds in a source, how it
 * names controls, which ones are gaps, the API names it gives, and that the console has none today.
 *   node framework/spec/check-api-coverage.mjs
 */
import assert from 'node:assert/strict';
import { apiNames, arrayIds, build, mapKeys, propOf, scanActions, scanControls, scanFile, serialize, settingKeys, tagAt } from '../cli/api-coverage.mjs';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

/* ---- JSX facts ---- */
const tag = tagAt('<Button onClick={() => go({ a: 1 })} label="x">Hi</Button>', 0);
ok(tag && tag.text.endsWith('label="x">') && !tag.selfClosing, 'a tag ends at the > outside braces');
eq(propOf(tag.text, 'label'), 'x', 'a string prop');
eq(propOf('<X aria-label={`Deny: ${p}`} />', 'aria-label'), '{`Deny: ${p}`}', 'an expression prop');

const src = `
export const plugin = {
  views: { 'plan-studio': () => null, builds: () => null },
  dialogs: { 'x.pick': { title: 'Pick' } },
  settingsTabs: [{ id: 'mine', label: 'Mine' }],
  settingsPanels: [{ id: 'mine.look', tab: 'mine', title: 'Look' }],
  settings: [{ id: 'g', label: 'G', settings: [
    { key: K.speak, label: 'Speak', kind: 'toggle' },
    { key: 'axf.mine.size', label: 'Size', kind: 'slider' },
    { key: 'axf.mine.head', label: 'Head', kind: 'section' },
  ] }],
  register(rt) {
    rt.actions.register('mine.open', () => 1, { label: 'Open mine', screen: 'mine' });
    rt.actions.register('mine.decide', () => 1, { label: 'Decide', personOnly: true });
  },
};
const K = { speak: 'axf.mine.speak' };
function V() {
  return <div role="toolbar" aria-label="Mine tools">
    <Button onClick={go}>Save</Button>
    <IconButton icon="x" label="Close" onClick={close} />
    <button className="fx-iconbtn" onClick={x}><Icon name="star" /></button>
    <button onClick={y}><Icon name="x" />{n} more</button>
    <label><input type="checkbox" checked={a} onChange={b} /> Wrapped</label>
    <Field label="Name"><input value={v} onChange={w} /></Field>
    <Button onClick={d} data-axf-person-only="">Approve</Button>
    <SelectField label="" ariaLabel="Pick one" value={v} options={o} onChange={c} />
  </div>;
}`;
eq(mapKeys(src, 'views').map((k) => k.id), ['plan-studio', 'builds'], 'view ids');
eq(mapKeys(src, 'dialogs').map((k) => k.id), ['x.pick'], 'dialog ids');
eq(arrayIds(src, 'settingsTabs').map((k) => k.id), ['mine'], 'settings tab ids');
eq(settingKeys(src).map((k) => k.id), ['axf.mine.speak', 'axf.mine.size'], 'setting keys, constants resolved, sections skipped');
const acts = scanActions(src);
eq(acts.map((a) => [a.id, a.personOnly, a.screen]), [['mine.open', false, 'mine'], ['mine.decide', true, '']], 'actions, person-only, window screens');
const ctl = scanControls(src);
eq(ctl.map((c) => [c.tag, c.named, c.personOnly]), [['Button', true, false], ['IconButton', true, false], ['button', false, false], ['button', true, false], ['input', true, false], ['input', true, false], ['Button', true, true], ['SelectField', true, false]], 'controls: named, unnamed (icon only), wrapped by a label or a Field, person-only, ariaLabel');
const entries = scanFile(src, 'x/web/index.tsx', 'plugin:x');
const st = (kind, id) => entries.find((x) => x.kind === kind && x.id === id)?.status;
eq(st('screen', 'plan-studio'), 'covered', 'a view is a covered screen');
eq(st('screen', 'mine'), 'covered', 'a window an action names is a screen');
eq(st('action', 'mine.decide'), 'person-only', 'a personOnly action is Brett\'s tap');
eq(st('setting', 'axf.mine.size'), 'covered', 'a setting key is a console value');
ok(entries.some((x) => x.kind === 'toolbar' && x.id === 'Mine tools'), 'toolbars are listed');
const gap = entries.find((x) => x.status === 'gap');
ok(gap && gap.kind === 'control' && /aria-label/.test(gap.fix), 'the unnamed icon button is the one gap, with the fix');
eq(apiNames({ api: 'console.values set axf.mine.size' }), { mcp: 'console_value(key="axf.mine.size")', cli: 'axf console value axf.mine.size [value]' }, 'MCP + CLI names of a value');
eq(apiNames({ api: 'console.elements toggle Mine tools/switch:Dark' }).cli, 'axf console toggle "Mine tools/switch:Dark"', 'CLI name of an element');
eq(apiNames({ api: 'plugins.commands run ui/decide' }).mcp, 'ui_decide', 'a plugin command is its MCP tool');

/* ---- the console itself ---- */
const reg = build();
eq(reg.summary.gap, 0, `the console has no UI element without an API path (${reg.summary.gap})`);
ok(reg.summary.elements > 1000 && reg.items.some((x) => x.kind === 'screen' && x.id === 'terminal'), 'the Terminal is a screen');
ok(JSON.parse(serialize(reg)).items.length === reg.items.length, 'the registry file is valid JSON, one element per line');
console.log(`✓ api coverage — ${n} checks`);
