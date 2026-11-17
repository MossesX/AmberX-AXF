/**
 * Lifecycle hooks (plugin-lifecycle@1). The notes themselves are Brett's (on the hub) and are never removed here.
 *
 * Project data (project-template@1): a project's notes live under the hub's `_shared/_claude/` (AmberX AXF: `notes/`,
 * any other project: `project-notes/<id>/`). A copy carries the notes' folders; with carry.items "all" the notes too
 * (Markdown and text, 512 KB each), with "none" nothing.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const claudeDir = () => join(process.env.AXHUB_PROJECTS_DIR || '/projects', '_shared', '_claude');
const notesDir = () => join(claudeDir(), 'notes');
const folderOf = (project) => (!project || project.base ? 'notes' : join('project-notes', project.id));
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/;
const NOTE = /\.(md|txt)$/i;
const FILE_BYTES = 512 * 1024;
const TOTAL_BYTES = 3 * 1024 * 1024;

export const projectDataLabel = 'Notes';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}; notes at ${notesDir()}`); }
export async function onUninstall(ctx) { ctx.log(`removing the notes browser; the notes stay at ${notesDir()}`); }
export async function checks(ctx) {
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'notes-folder', ok: true, detail: existsSync(notesDir()) ? notesDir() : `${notesDir()} (not mounted on this machine)` },
  ];
}

/** Plain folders and notes under `dir` (no links, no hidden files), as paths relative to it. */
function walk(dir, rel = '', out = { folders: [], notes: [] }) {
  for (const n of readdirSync(join(dir, rel)).sort()) {
    if (!SEGMENT.test(n)) continue;
    const r = rel ? `${rel}/${n}` : n;
    const st = lstatSync(join(dir, r));
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) { out.folders.push(r); walk(dir, r, out); } else if (st.isFile() && NOTE.test(n)) out.notes.push({ path: r, bytes: st.size });
  }
  return out;
}

export async function exportProjectData(ctx) {
  const items = ctx.carry?.items ?? 'structure';
  const dir = join(claudeDir(), folderOf(ctx.project));
  if (items === 'none' || !existsSync(dir)) return null;
  const w = walk(dir);
  const notes = {};
  let total = 0;
  if (items === 'all') {
    for (const n of w.notes) {
      if (n.bytes > FILE_BYTES || total + n.bytes > TOTAL_BYTES) continue;
      notes[n.path] = readFileSync(join(dir, n.path), 'utf8');
      total += n.bytes;
    }
  }
  return w.folders.length || Object.keys(notes).length ? { folders: w.folders, notes } : null;
}

export async function importProjectData(ctx, data) {
  if (!existsSync(claudeDir())) throw new Error(`the hub's shared Claude files (${claudeDir()}) aren't mounted here`);
  const dir = join(claudeDir(), folderOf(ctx.project));
  const ok = (p) => typeof p === 'string' && p.split('/').every((s) => SEGMENT.test(s));
  let folders = 0;
  let notes = 0;
  for (const f of data?.folders ?? []) { if (ok(f) && !existsSync(join(dir, f))) { mkdirSync(join(dir, f), { recursive: true }); folders++; } }
  for (const [p, text] of Object.entries(data?.notes ?? {})) {
    if (!ok(p) || !NOTE.test(p) || typeof text !== 'string' || existsSync(join(dir, p))) continue;
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), text);
    notes++;
  }
  return { note: `${folders} folder(s)${notes ? `, ${notes} note(s)` : ', no notes'}` };
}
