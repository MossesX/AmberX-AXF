#!/usr/bin/env node
/** Rebuilds framework/boilerplates/index.json from every <id>/boilerplate.json. */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../boilerplates');
const cats = { productivity: 'Productivity', media: 'Media', location: 'Location', devops: 'Dev & Ops', business: 'Business', social: 'Social', assistant: 'AI & voice', utility: 'Utilities', starter: 'Starters', imported: 'Imported' };
const items = readdirSync(dir).filter((d) => existsSync(join(dir, d, 'boilerplate.json'))).map((d) => JSON.parse(readFileSync(join(dir, d, 'boilerplate.json'), 'utf8')))
  .map((b) => ({ id: b.id, name: b.name, category: b.category, description: b.description, features: (b.features ?? []).length, screens: (b.screens ?? []).length, modules: b.modules ?? [], libraries: (b.libraries ?? []).map((l) => (typeof l === 'string' ? l : l.library)), status: b.status ?? 'planned', source: b.source ?? 'amberx' }));
writeFileSync(join(dir, 'index.json'), JSON.stringify({ $axf: 'boilerplates@1', categories: Object.entries(cats).map(([id, label]) => ({ id, label })), items }, null, 2) + '\n');
console.log(`${items.length} boilerplates indexed`);
