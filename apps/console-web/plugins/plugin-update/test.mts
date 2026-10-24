// @ts-nocheck: a Node test (node --experimental-strip-types), not part of the console's build
// Plugin Update, the pure part (web/core.ts). Run: node --experimental-strip-types apps/console-web/plugins/plugin-update/test.mts
import { compareVersions, rebuildId, rebuildRequest, rows, summary } from './web/core.ts';

let ok = 0, fail = 0;
const check = (name: string, cond: boolean) => { if (cond) ok++; else { fail++; console.error(`✗ ${name}`); } };

check('versions compare by number', compareVersions('1.2.10', '1.2.9') > 0 && compareVersions('1.0.0', '1.0.0') === 0 && compareVersions('1.0.0-rc1', '1.0.0') < 0);

const installed = [
  { folder: 'theme-manager', id: 'a.theme', name: 'Theme manager', version: '0.1.0', enabled: true, builtWith: { model: 'opus', builtAt: '2026-10-18' } },
  { folder: 'todo-manager', id: 'a.todo', name: 'Todo manager', version: '0.1.0', enabled: true, builtWith: { model: 'opus', builtAt: '2026-10-22' } },
  { folder: 'agent-manager', id: 'a.agents', name: 'Agent manager', version: '0.2.0', enabled: false, builtWith: { model: 'fable', builtAt: '2026-10-20' } },
  { folder: '_template', id: 'a.tpl', name: 'Template', version: '0.0.1', enabled: false },
];
const catalog = [
  { kind: 'console', folder: 'theme-manager', id: 'a.theme', name: 'Theme manager', version: '0.3.0', versions: ['0.1.0', '0.2.0', '0.3.0'], models: { '0.1.0': 'opus', '0.2.0': 'opus', '0.3.0': 'fable' } },
  { kind: 'console', folder: 'todo-manager', id: 'a.todo', name: 'Todo manager', version: '0.1.0', versions: ['0.1.0'], models: { '0.1.0': 'opus' } },
  { kind: 'pilot', folder: 'agent-manager', id: 'a.agents', name: 'x', version: '9.0.0' },
];
const pending = [{ id: rebuildId('todo-manager', 'fable'), status: 'pending' }];
const r = rows(installed, catalog, pending);
const by = (f: string) => r.find((x) => x.folder === f)!;
check('templates are left out, sorted by name', r.map((x) => x.folder).join() === 'agent-manager,theme-manager,todo-manager');
check('model + build date + version', by('theme-manager').model === 'opus' && by('theme-manager').builtAt === '2026-10-18' && by('theme-manager').version === '0.1.0');
check('same-model update = the newest same-model version', by('theme-manager').update === '0.2.0');
check('another model\'s build = Replace', by('theme-manager').replace?.model === 'fable' && by('theme-manager').replace?.version === '0.3.0');
check('up to date: nothing to do', by('todo-manager').update === null && by('todo-manager').replace === null && by('todo-manager').inCatalog);
check('rebuild offers the other models', by('todo-manager').rebuildWith.join() === 'fable,sonnet' && by('agent-manager').rebuildWith.join() === 'opus,sonnet');
check('a parked rebuild is shown, not offered again', by('todo-manager').parked.length === 1 && by('todo-manager').parked[0]!.model === 'fable');
check('other kinds in the catalog never match', !by('agent-manager').inCatalog && by('agent-manager').update === null);
const req = rebuildRequest(by('todo-manager'), 'fable');
check('rebuild request: pending add, Fable, same folder + id', req.action === 'add' && req.model === 'Fable' && req.id === 'rebuild-todo-manager-fable' && String(req.detail).includes('Same folder and same id'));
check('rebuild request is split into steps of ≤ 30 min', Array.isArray(req.subPrompts) && (req.subPrompts as { estimate: string }[]).every((s) => /^(\d+) min$/.test(s.estimate) && Number(s.estimate.split(' ')[0]) <= 30));
check('summary counts models + updates', /3 plugins \(1 Fable, 2 Opus\) · 1 update · 1 other-model build/.test(summary(r)));

console.log(`plugin-update: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
