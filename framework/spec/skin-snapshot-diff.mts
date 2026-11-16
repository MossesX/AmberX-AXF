/**
 * Compile a skin as the hub default and diff it against a look snapshot (look-snapshot@1): every slot, the asset data
 * behind it (the tokens), spacing, hidden chrome and the token settings must match 1:1. Exit 1 on any difference.
 *
 *   npx -y tsx framework/spec/skin-snapshot-diff.mts <skin id> <snapshot.json> [--json]
 *
 * Two places are compiled: an app with no picks of its own standing on the floor (the snapshot app's saved defaults
 * fill what the skin leaves), and the snapshot app itself after it adopts the floor (adoptHubDefault).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeLookAt, normalizeSkin, skinFromDesignPackage } from '../core/engines/skin.ts';
import { adoptHubDefault, newAppLook, normalizeAppLook } from '../core/engines/skin-rules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = join(ROOT, 'framework/assets');
const [skinId, snapFile] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!skinId || !snapFile) { console.error('usage: skin-snapshot-diff.mts <skin id> <snapshot.json> [--json]'); process.exit(2); }

const read = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const asset = (type: string, id: string) => { const f = join(ASSETS, type, `${id}.json`); return existsSync(f) ? read(f) : null; };
const skinOf = (id: string) => { const s = asset('skin', id); if (s) return normalizeSkin(s.data); const p = asset('design-package', id); return p ? skinFromDesignPackage(p.data) : null; };
const snap = read(snapFile);
const want = snap.resolved;

const TOKEN_KEYS = ['axf.tokens.style', 'axf.tokens.layout', 'axf.banners.group'];
const wantSettings: Record<string, unknown> = {
  'axf.tokens.style': want.styleTheme.hubTokenOverride,
  'axf.tokens.layout': want.layout.ownTokens,
  'axf.banners.group': want.chrome.bannerGroup,
};

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

function diff(label: string, look: any) {
  const shared = { ...snap.raw.appearance, defaultSkin: { id: skinId, overrides: {} } };
  // the shared document's own token overrides are hub settings every app reads anyway; the floor must carry them itself
  shared.settings = Object.fromEntries(Object.entries(shared.settings ?? {}).filter(([k]) => !TOKEN_KEYS.includes(k)));
  const { doc, skin } = composeLookAt(shared as any, look, skinOf, null);
  const out: string[] = [];
  if (skin.from !== 'default' || skin.id !== skinId) out.push(`skin in force: ${skin.id || '(none)'} from ${skin.from}, expected ${skinId} from default`);
  const types = new Set([...Object.keys(want.slots), ...Object.keys(doc.slots)]);
  for (const t of [...types].sort()) {
    const a = want.slots[t], b = doc.slots[t];
    if (a !== b) { out.push(`slot ${t}: ${a} → ${b}`); continue; }
    const wa = want.assets[t]?.data, ga = asset(t, b)?.data;
    if (wa && stable(wa) !== stable(ga)) out.push(`tokens ${t}/${b}: asset data differs`);
  }
  if ((doc.spacing ?? '') !== want.spacing) out.push(`spacing: ${want.spacing} → ${doc.spacing}`);
  for (const [t, v] of Object.entries(want.chrome.hidden)) if (Boolean(doc.hidden?.[t]) !== Boolean(v)) out.push(`hidden ${t}: ${v} → ${doc.hidden?.[t]}`);
  for (const [k, v] of Object.entries(wantSettings)) if (stable(doc.settings?.[k]) !== stable(v)) out.push(`setting ${k}: ${stable(v)} → ${stable(doc.settings?.[k])}`);
  const ct = asset('color-theme', doc.slots['color-theme'])?.data?.tokens;
  if (stable(ct) !== stable(want.colorTheme.light.tokens)) out.push('colour tokens (light) differ');
  const over = (doc.settings?.['axf.tokens.style'] as any)?.['*'] ?? {};
  const st = { ...asset('style-theme', doc.slots['style-theme'])?.data, ...over };
  if (stable(st) !== stable(want.styleTheme.tokens)) out.push('style tokens differ');
  return { label, slots: Object.keys(doc.slots).length, differences: out };
}

const raw = normalizeAppLook(snap.raw.look);
if (!raw) { console.error('snapshot has no valid app-look@1'); process.exit(2); }
const results = [
  diff('fresh app on the floor', newAppLook(raw.app, raw.default)),
  diff(`${raw.app} after adopting the floor`, adoptHubDefault(raw, { at: snap.capturedAt, by: 'skin-snapshot-diff' })),
];
const dark: string | undefined = asset('skin', skinId)?.data?.colorThemes?.dark;
const darkOk = !!dark && asset('color-theme', dark)?.data?.scheme === 'dark';
if (process.argv.includes('--json')) console.log(JSON.stringify({ skin: skinId, results, dark }, null, 2));
else {
  for (const r of results) console.log(`${r.differences.length ? '✗' : '✓'} ${r.label}: ${r.slots} slots, ${r.differences.length} difference(s)${r.differences.map((d) => `\n    ${d}`).join('')}`);
  console.log(`${darkOk ? '✓' : '✗'} dark pair: ${dark ?? '(none)'}`);
}
process.exit(results.some((r) => r.differences.length) || !darkOk ? 1 : 0);
