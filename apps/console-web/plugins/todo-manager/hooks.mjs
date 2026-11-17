/**
 * Lifecycle hooks (plugin-lifecycle@1). Everything the Todo manager writes is store.json in ctx.dataDir (AmberX AXF)
 * or ctx.dataDir/projects/<id>/store.json (any other project).
 *
 * Project data (project-template@1): a copy of a project carries its entry types and its lists (the list structure);
 * with carry.items "all" every entry too, with "none" only the types.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const baseDir = (ctx) => process.env.AXF_TODO_DIR || ctx.dataDir;
const storeOf = (ctx) => join(ctx.projectDir(baseDir(ctx)), 'store.json');
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

export const projectDataLabel = 'Lists and to-dos';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('removing the Todo manager data (every list and entry)'); }
export async function checks(ctx) {
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'store', ok: true, detail: existsSync(join(ctx.dataDir, 'store.json')) ? 'store.json present' : 'no lists yet' },
  ];
}

export async function exportProjectData(ctx) {
  const s = readJson(storeOf(ctx));
  if (!s || typeof s !== 'object') return null;
  const lists = Array.isArray(s.lists) ? s.lists.filter((x) => x && Number.isInteger(x.id)).map(({ counts, ...x }) => x) : [];
  const ids = new Set(lists.map((x) => x.id));
  const items = ctx.carry?.items ?? 'structure';
  return {
    types: s.types ?? null,
    lists: items === 'none' ? [] : lists,
    entries: items === 'all' && Array.isArray(s.entries) ? s.entries.filter((e) => e && ids.has(e.listId)) : [],
  };
}

export async function importProjectData(ctx, data) {
  const f = storeOf(ctx);
  const have = readJson(f);
  if (have && ((have.lists ?? []).length || (have.entries ?? []).length)) return { note: 'the project already has lists: left as they are' };
  const lists = Array.isArray(data?.lists) ? data.lists : [];
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  const top = Math.max(0, ...lists.map((x) => x.id), ...entries.map((e) => e.id));
  const out = { $axf: 'todo-store@1', ...(data?.types ? { types: data.types } : {}), lists, entries, nextId: top + 1 };
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(out, null, 1)}\n`);
  renameSync(tmp, f);
  return { note: `${lists.length} list(s)${entries.length ? `, ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}` : ', no items'}` };
}
