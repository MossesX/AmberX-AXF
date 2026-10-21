/**
 * Self-test for embed@1 on the web port (CI: npx -y tsx framework/spec/check-embed.mts).
 *  1. replays spec/fixtures/embed.json against core/engines/embed.ts (the Kotlin EmbedEngine replays the same file)
 *  2. replays the `forced` cases of spec/fixtures/hide.json against core/engines/hide.ts
 *  3. drives the runtime: an embedded app hides the host's chrome over the user's choice, the choice survives, settings
 *     say who shows it, a standalone runtime is untouched, the frame carries data-axf-embed
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_HIDDEN, EMBED_UA_TOKEN, detectEmbed, embedFromQuery, embedFromUserAgent, embedHidden, embedHost, embedUrl, userAgentSuffix } from '../core/engines/embed';
import { hiddenSlots } from '../core/engines/hide';
import { AxfRuntime, HIDE_KEY } from '../core/runtime';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const f = JSON.parse(readFileSync(new URL('./fixtures/embed.json', import.meta.url), 'utf8'));
const h = JSON.parse(readFileSync(new URL('./fixtures/hide.json', import.meta.url), 'utf8'));
let checks = 0;
const norm = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const eq = (a: unknown, b: unknown, what: string) => { assert.deepEqual(norm(a), norm(b), what); checks++; };

/* ---------- 1. embed.json ---------- */
eq(EMBED_UA_TOKEN, f.token, 'token');
eq(DEFAULT_HIDDEN, f.defaultHidden, 'default hidden');
for (const c of f.hosts) eq(embedHost(c.input), c.host, `host ${JSON.stringify(c.input)}`);
for (const c of f.hidden) eq(embedHidden(c.input), c.hidden, `hidden ${JSON.stringify(c.input)}`);
for (const c of f.queries) eq(embedFromQuery(c.input), c.embed, `query ${c.input}`);
for (const c of f.userAgents) eq(embedFromUserAgent(c.input), c.embed, `ua ${c.input}`);
for (const c of f.detect) eq(detectEmbed(c.search, c.userAgent), c.embed, `detect ${c.search} / ${c.userAgent}`);
for (const c of f.suffix) eq(userAgentSuffix(c.host, c.hidden ?? undefined), c.suffix, `suffix ${c.host} ${JSON.stringify(c.hidden)}`);
for (const c of f.urls) eq(embedUrl(c.url, c.host, c.hidden ?? undefined), c.out, `url ${c.url}`);
assert.throws(() => userAgentSuffix('bad id'), /bad host id/); checks++;
assert.throws(() => embedUrl('https://x/', ''), /bad host id/); checks++;

/* ---------- 2. hide.json forced layer ---------- */
for (const c of h.cases) eq(hiddenSlots(c.overrides, c.defaults ?? [], c.forced ?? []), c.hidden, `hide ${JSON.stringify(c)}`);
assert.ok(h.cases.some((c: { forced?: string[] }) => c.forced?.length), 'hide.json carries forced cases'); checks++;

/* ---------- 3. runtime ---------- */
const root = new URL('..', import.meta.url).pathname;
const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const manifest = { app: { id: 'test', name: 'Test' }, defaults } as never;
const make = (embed: ReturnType<typeof detectEmbed> | undefined) => new AxfRuntime({ manifest, assets, storageKey: `axf-test:${Math.random()}`, embed });

const solo = make(null);
eq(solo.embedded, null, 'standalone: no embed');
eq(solo.slotHidden('banner'), false, 'standalone: banner shown');
eq(solo.slotHiddenByHost('banner'), false, 'standalone: not by host');

const inside = make({ host: 'patches', hidden: ['banner'] });
eq(inside.embedded, { host: 'patches', hidden: ['banner'] }, 'embedded: host known');
eq(inside.slotHidden('banner'), true, 'embedded: banner hidden');
eq(inside.slotHiddenByHost('banner'), true, 'embedded: by the host');
eq(inside.slotHidden('toolbar'), solo.slotHidden('toolbar'), 'embedded: other chrome untouched');
eq(inside.banner().data, null, 'embedded: rt.banner() empty');
eq(inside.compileStyles().vars['--fx-banner-h'], '0px', 'embedded: banner height var is 0');
eq(solo.compileStyles().vars['--fx-banner-h'] !== '0px', true, 'standalone: banner has height');
// The user's own choice can't bring it back while embedded, and nothing is written for it.
inside.settings.clear(HIDE_KEY('banner'));
inside.setSlotHidden('banner', false);
eq(inside.slotHidden('banner'), true, 'embedded: show refused');
eq(inside.settings.get(HIDE_KEY('banner')), null, 'embedded: no override written');
// A saved "shown" choice stays saved for standalone runs.
inside.settings.set(HIDE_KEY('banner'), false);
eq(inside.slotHidden('banner'), true, 'embedded: forced over a saved false');
eq(inside.settings.get(HIDE_KEY('banner')), false, 'embedded: saved choice kept');
// Hidden slots list = host's over user's over app's.
const both = make({ host: 'patches', hidden: ['banner', 'toolbar'] });
both.settings.set(HIDE_KEY('toolbar'), false);
eq(both.hiddenSlots().includes('toolbar') && both.hiddenSlots().includes('banner'), true, 'embedded: two forced');
// Detection from the page when `embed` is omitted: no page here → standalone.
eq(make(undefined).embedded, null, 'no page: standalone');
// Node's navigator is a getter-only global: define over it for the test, then put it back.
const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Mozilla/5.0 AXF-Embed/patches/none' } });
eq(make(undefined).embedded, { host: 'patches', hidden: [] }, 'page ua: detected (none hidden)');
Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '?axf-embed=dev-console' } });
eq(make(undefined).embedded, { host: 'dev-console', hidden: ['banner'] }, 'page query wins');
delete (globalThis as { location?: unknown }).location;
if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc); else delete (globalThis as { navigator?: unknown }).navigator;

console.log(`check-embed: ${checks} checks passed`);
