/**
 * Bringing a build forward on the orchestrator (focus.ts; console-commands-reliable, Nov 11 2026): the ask is kept for
 * a tab that mounts later, settled once shown, and the row selector finds a build's card or grid row.
 *   npx -y tsx framework/spec/check-orchestrator-focus.mts
 */
import assert from 'node:assert/strict';

const g = globalThis as unknown as Record<string, unknown>;
const et = new EventTarget();
const heard: string[] = [];
g.window = et;
g.CustomEvent ??= class<T> extends Event { detail: T; constructor(type: string, init?: { detail?: T }) { super(type); this.detail = init?.detail as T; } };
et.addEventListener('axf:orchestrator-focus', (e) => heard.push(String((e as CustomEvent<string>).detail)));
const { buildRowSelector, focusBuild, settleFocus, wantedBuild } = await import('../../apps/console-web/plugins/build-orchestrator/web/focus');

let n = 0;
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };

eq(wantedBuild(), '', 'nothing asked yet');
focusBuild('console-commands-reliable');
eq(heard, ['console-commands-reliable'], 'a mounted tab hears the ask at once');
eq(wantedBuild(), 'console-commands-reliable', 'a tab that mounts later (the tab switch) still picks it up');
eq(wantedBuild(Date.now() + 31_000), '', 'an old ask is forgotten (a later visit does not jump)');
settleFocus('other-build');
eq(wantedBuild(), 'console-commands-reliable', 'settling another build leaves this ask');
settleFocus('console-commands-reliable');
eq(wantedBuild(), '', 'settled once shown');
eq(buildRowSelector('a-b'), '[data-fx-ctx-target="axf-orchestrator-build"][data-fx-ctx-payload="a-b"]', 'the card / grid row of a build');
eq(buildRowSelector('x"y'), '[data-fx-ctx-target="axf-orchestrator-build"][data-fx-ctx-payload="x\\"y"]', 'quotes escaped');

console.log(`✓ build orchestrator focus — ${n} checks`);
