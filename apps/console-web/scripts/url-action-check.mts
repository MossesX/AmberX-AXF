/**
 * ?axf-action= links (src/urlAction.ts): read once and taken off the address, run when the action is registered
 * (a lazy plugin registers late), navigate actions only.
 *
 *   npx -y tsx apps/console-web/scripts/url-action-check.mts
 */
import assert from 'node:assert/strict';
import { runUrlAction, takeUrlAction, URL_ACTION_PARAM } from '../src/urlAction.ts';

const win = (href: string) => {
  const w = { location: { href }, history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => { w.location.href = url; } } };
  return w as unknown as { location: { href: string }; history: History };
};
const fakeRt = () => {
  const handlers = new Map<string, { meta: { label: string; effect?: string } }>();
  const out = { dispatched: [] as string[], toasts: [] as string[] };
  const rt = {
    actions: { get: (id: string) => handlers.get(id) },
    dispatch: (spec: string) => { out.dispatched.push(spec); return true; },
    toast: (msg: string) => { out.toasts.push(msg); },
  };
  return { rt: rt as never, handlers, out };
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const t = async (name: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log(`  ✓ ${name}`); };

await t('reads the action and takes it off the address, keeping the rest', () => {
  const w = win(`https://c.example/?${URL_ACTION_PARAM}=build-orchestrator.open-build%3Amy-build&orch-build=my-build`);
  assert.equal(takeUrlAction(w), 'build-orchestrator.open-build:my-build');
  assert.equal(w.location.href, 'https://c.example/?orch-build=my-build');
  assert.equal(takeUrlAction(w), '');
});
await t('refuses a malformed spec', () => {
  assert.equal(takeUrlAction(win('https://c.example/?axf-action=%20rm%20-rf')), '');
  assert.equal(takeUrlAction(win('https://c.example/')), '');
});
await t('a navigate action runs, also when it registers late (a lazy plugin)', async () => {
  const { rt, handlers, out } = fakeRt();
  runUrlAction(rt, 'plug.open:x', { tries: 5, everyMs: 10 });
  handlers.set('plug.open', { meta: { label: 'Open', effect: 'navigate' } });
  await wait(40);
  assert.deepEqual(out.dispatched, ['plug.open:x']);
});
await t('anything but a navigate action is refused from a link', () => {
  const { rt, handlers, out } = fakeRt();
  handlers.set('plug.delete', { meta: { label: 'Delete', effect: 'destructive' } });
  handlers.set('plug.plain', { meta: { label: 'Plain' } });
  runUrlAction(rt, 'plug.delete:x'); runUrlAction(rt, 'plug.plain');
  assert.deepEqual(out.dispatched, []); assert.equal(out.toasts.length, 2);
});
await t('an action that never comes says so', async () => {
  const { rt, out } = fakeRt();
  runUrlAction(rt, 'nobody.here', { tries: 2, everyMs: 5 });
  await wait(40);
  assert.deepEqual(out.dispatched, []); assert.match(out.toasts[0] ?? '', /Nothing in this console opens nobody\.here/);
});
console.log(`url-action: ${n} checks passed`);
