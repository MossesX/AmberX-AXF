// Copies the framework's catalog / tracker / libraries / boilerplates into public/data so the console
// works as a static site (no backend) — the Python API serves the same files live when present.
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const OUT = resolve(HERE, '../public/data');
// live data comes from the hub's persist folder when there is one (framework/cli/persist.mjs)
const { dataPath } = await import('../../../framework/cli/persist.mjs');
mkdirSync(OUT, { recursive: true });
cpSync(join(ROOT, 'framework/catalog/catalog.json'), join(OUT, 'catalog.json'));
cpSync(dataPath('framework/catalog/libraries.json'), join(OUT, 'libraries.json'));
cpSync(dataPath('framework/catalog/status.json'), join(OUT, 'status.json'));
cpSync(dataPath('tracker.json'), join(OUT, 'tracker.json'));
cpSync(join(ROOT, 'framework/boilerplates/index.json'), join(OUT, 'boilerplates.json'));
const idx = JSON.parse(readFileSync(join(ROOT, 'framework/boilerplates/index.json'), 'utf8'));
const items = idx.items.map((i) => JSON.parse(readFileSync(join(ROOT, 'framework/boilerplates', i.id, 'boilerplate.json'), 'utf8')));
writeFileSync(join(OUT, 'boilerplate-items.json'), JSON.stringify(items));
const settings = readFileSync(join(ROOT, 'framework/android/settings.gradle.kts'), 'utf8');
const modules = [...settings.matchAll(/include\("(:[^"]+)"\)/g)].map((m) => m[1].slice(1)).map((name) => {
  const readme = join(ROOT, 'framework/android', name, 'README.md');
  const first = existsSync(readme) ? readFileSync(readme, 'utf8').split('\n').find((l) => l && !l.startsWith('#'))?.trim() ?? '' : '';
  return { name, kind: name.startsWith('lib-') ? 'library' : name.startsWith('kit-') ? 'kit' : name.startsWith('axf-') ? 'framework' : 'other', description: first };
});
writeFileSync(join(OUT, 'modules.json'), JSON.stringify({ modules }));
// library templates (metadata + file lists) for the Library templates tab
{
  const { listLibraryTemplates } = await import('../../../framework/cli/library-templates.mjs');
  writeFileSync(join(OUT, 'library-templates.json'), JSON.stringify({ items: listLibraryTemplates() }));
}
// the plan + its screenshots
if (existsSync(dataPath('framework/plan/plan.json'))) {
  cpSync(dataPath('framework/plan/plan.json'), join(OUT, 'plan.json'));
  if (existsSync(dataPath('framework/plan/media/'))) cpSync(dataPath('framework/plan/media/'), join(OUT, 'plan-media'), { recursive: true });
}
// the build queue: its state + the shared queue logic (copied into src so the console computes the same queue offline)
if (existsSync(dataPath('framework/plan/build-queue.json'))) cpSync(dataPath('framework/plan/build-queue.json'), join(OUT, 'build-queue.json'));
mkdirSync(resolve(HERE, '../src/axf/plan'), { recursive: true });
if (existsSync(dataPath('framework/plan/pending.json'))) cpSync(dataPath('framework/plan/pending.json'), join(OUT, 'pending.json'));
for (const f of ['build-queue-core.mjs', 'build-queue-core.d.mts', 'pending-core.mjs', 'pending-core.d.mts']) cpSync(join(ROOT, 'framework/plan', f), resolve(HERE, '../src/axf/plan', f));
console.log(`console data synced → public/data (${items.length} boilerplates, ${modules.length} modules)`);
