#!/usr/bin/env node
/** Self-test: packs/index.json is well-formed and every screenshot it lists exists. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const ix = JSON.parse(readFileSync(join(here, 'packs/index.json'), 'utf8'));
let n = 0; const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1; };
const ids = new Set();
for (const p of ix.packs) {
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(p.id)) fail(`bad id ${p.id}`);
  if (ids.has(p.id)) fail(`duplicate id ${p.id}`); ids.add(p.id);
  if (!(p.round >= 1) || !p.name || !['light', 'dark'].includes(p.scheme)) fail(`pack ${p.id} incomplete`);
  for (const f of p.files) { n++; if (!/^r\d{1,3}\/[a-z0-9][a-z0-9-]{0,120}\.(png|jpg|jpeg|webp)$/.test(f.src)) fail(`bad src ${f.src}`); else if (!existsSync(join(here, 'packs', f.src))) fail(`missing ${f.src}`); }
}
if (!process.exitCode) console.log(`design-packs: ${ix.packs.length} packs, ${n} screenshots ok`);
