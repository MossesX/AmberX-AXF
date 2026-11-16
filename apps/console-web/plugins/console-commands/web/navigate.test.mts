// @ts-nocheck: a Node test, not part of the console's build
/**
 * The console tab's navigate (open-url-route@1 console-tab) with a fake window and document.
 *   npx -y tsx apps/console-web/plugins/console-commands/web/navigate.test.mts
 */
import assert from 'node:assert/strict';
import { navigateHere } from './navigate.ts';

let n = 0;
const t = (name: string, fn: () => void) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

function fake(href: string, opts: { blocked?: boolean; hidden?: boolean } = {}) {
  const calls: string[] = [];
  const win = {
    location: { href, assign: (u: string) => calls.push(`assign ${u}`) },
    focus: () => calls.push('focus'),
    open: (u: string) => { calls.push(`open ${u}`); return opts.blocked ? null : { opener: {}, focus: () => calls.push('child focus') }; },
  } as unknown as Window;
  const doc = { visibilityState: opts.hidden ? 'hidden' : 'visible' } as Document;
  return { win, doc, calls };
}

const HERE = 'https://console.amberxai.com/';
t('a console route opens in place, after the ack', () => {
  const f = fake(HERE);
  const r = navigateHere('https://console.amberxai.com/?axf-cmd=c-1', undefined, f.win, f.doc);
  assert.equal(r.opened, true); assert.equal(r.mode, 'in-place');
  assert.deepEqual(f.calls, ['focus']);
  r.then!();
  assert.deepEqual(f.calls, ['focus', 'assign https://console.amberxai.com/?axf-cmd=c-1']);
});
t('the page already shown: already-here, nothing moves', () => {
  const f = fake(HERE);
  const r = navigateHere(HERE, undefined, f.win, f.doc);
  assert.equal(r.mode, 'already-here'); assert.equal(r.then, undefined);
});
t('another amberxai.com page opens in a new tab', () => {
  const f = fake(HERE);
  const r = navigateHere('https://plan.amberxai.com/x', undefined, f.win, f.doc);
  assert.equal(r.mode, 'new-tab'); assert.ok(f.calls.includes('open https://plan.amberxai.com/x'));
});
t('a blocked new tab falls back to this tab', () => {
  const f = fake(HERE, { blocked: true });
  const r = navigateHere('https://plan.amberxai.com/x', undefined, f.win, f.doc);
  assert.equal(r.opened, true); assert.equal(r.mode, 'same-tab');
  r.then!(); assert.ok(f.calls.includes('assign https://plan.amberxai.com/x'));
});
t('newTab true / false force either', () => {
  const a = fake(HERE); assert.equal(navigateHere('https://console.amberxai.com/y', true, a.win, a.doc).mode, 'new-tab');
  const b = fake(HERE); assert.equal(navigateHere('https://plan.amberxai.com/', false, b.win, b.doc).mode, 'same-tab');
});
t('a hidden tab does not take it: console-behind', () => {
  const f = fake(HERE, { hidden: true });
  const r = navigateHere('https://console.amberxai.com/', undefined, f.win, f.doc);
  assert.equal(r.opened, false); assert.equal(r.reason, 'console-behind'); assert.deepEqual(f.calls, []);
});
t('other hosts, http, ports, user info: refused', () => {
  for (const u of ['https://evil.com/', 'http://console.amberxai.com/', 'https://console.amberxai.com:8443/', 'https://u@console.amberxai.com/', 'https://amberxai.com.evil.com/', 'nope']) {
    const f = fake(HERE);
    const r = navigateHere(u, undefined, f.win, f.doc);
    assert.equal(r.reason, 'url-refused', u); assert.deepEqual(f.calls, [], u);
  }
});
console.log(`console tab navigate: ${n} checks passed`);
