/**
 * project-home — a projects@1 project's home in the hub's projects tree (axhub-projects@1), the same layout every
 * other hub project has:
 *
 *   /projects/<id>/_data/project.manifest.json   project-manifest@1, validated against the Standards rules in force
 *   /projects/<id>/_claude/                      README.md, rules/RULES.md, instructions/README.md,
 *                                                memory/README.md, memory/decisions.md, memory/<id>.md, shared/
 *
 * Where: AXHUB_PROJECTS_DIR (default /projects) when it exists; otherwise (laptops, CI) `project-homes/` next to the
 * shared data (AXF_DATA_DIR) or in the repo's private .axf-console/ folder. Never overwrites a file that is there, and
 * refuses a folder that already belongs to something else (another repo's hub project).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { draftManifest, formatProjectValidation, loadRules, PROJECT_MANIFEST_FILE, validateProjectManifest } from './project.mjs';
import { DEFAULT_PROJECTS_DIR, REPO_ROOT, persistRoot } from './persist.mjs';

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

/** The folder project homes go in. */
export function homesRoot() {
  const hub = process.env.AXHUB_PROJECTS_DIR || DEFAULT_PROJECTS_DIR;
  if (existsSync(hub)) return hub;
  return join(persistRoot() ?? join(REPO_ROOT, '.axf-console'), 'project-homes');
}

export const homeDir = (id) => join(homesRoot(), id);
export const manifestFile = (id) => join(homeDir(id), '_data', PROJECT_MANIFEST_FILE);

/** The marker a home made here carries in its manifest (`x.project`), so a re-created project adopts its own home. */
const ownedBy = (m, id) => m?.x?.project?.id === id;

/**
 * Why `id` can't have a home here ('' when it can): its folder exists and isn't this project's (another hub project,
 * or files with no manifest of ours).
 */
export function homeConflict(id) {
  const dir = homeDir(id);
  if (!existsSync(dir)) return '';
  const m = readJson(manifestFile(id));
  if (ownedBy(m, id)) return '';
  return `the hub already has a folder ${dir}${m?.name ? ` (project ${m.name})` : ''}; pick another id`;
}

/** The project's manifest (project-manifest@1). `project` = the registry entry ({ id, name, description, repo?, skin? }). */
export function projectManifest(project, { by = '', seed = 'none' } = {}) {
  const [owner, repoName] = project.repo ? project.repo.split('/') : [undefined, undefined];
  const m = draftManifest({
    name: project.id, displayName: project.name, description: project.description || `${project.name}: a console project.`,
    kind: 'app', relation: 'none', owner, repoName, exists: !!project.repo, visibility: 'private',
  });
  if (!project.repo) m.location = { repo: `${m.repo.owner}/${m.repo.name}`, path: '.' };
  m.x = { project: { $axf: 'projects@1', id: project.id, profile: project.profile, ...(project.skin ? { skin: project.skin } : {}), ...(seed !== 'none' ? { seed } : {}), ...(by ? { createdBy: by } : {}) } };
  return m;
}

/** Checks a manifest against the rules in force; throws with every error when it fails. */
export function checkManifest(m) {
  const v = validateProjectManifest(m, loadRules());
  if (!v.ok) throw new Error(`the project manifest fails the Standards rules:\n${formatProjectValidation(v, PROJECT_MANIFEST_FILE)}`);
  return v;
}

function writeNew(file, text, made) {
  if (existsSync(file)) return;
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
  made.push(file);
}

/** Make (or adopt) the project's home. Returns { dir, manifestFile, manifest, validation, made: [files] }. */
export function makeHome(project, { by = '', seed = 'none' } = {}) {
  const conflict = homeConflict(project.id);
  if (conflict) throw new Error(conflict);
  const manifest = projectManifest(project, { by, seed });
  const validation = checkManifest(manifest);
  const dir = homeDir(project.id);
  const cl = join(dir, '_claude');
  for (const d of [join(dir, '_data'), join(cl, 'rules'), join(cl, 'instructions'), join(cl, 'memory'), join(cl, 'shared')]) mkdirSync(d, { recursive: true });
  const made = [];
  const name = project.id;
  const today = new Date().toISOString().slice(0, 10);
  writeNew(manifestFile(name), `${JSON.stringify(manifest, null, 2)}\n`, made);
  writeNew(join(cl, 'README.md'), `# _claude (axhub-projects@1)\n\nClaude files for **${name}**, synced with the hub's \`/projects/${name}/_claude/\` (\`shared/\` ↔ \`/projects/_shared/_claude/\`).\nNever store secrets.\n\n| Folder | What goes there |\n| --- | --- |\n| \`rules/\` | Hard rules for this project. |\n| \`instructions/\` | How to work: procedures, checklists, deploy guides. |\n| \`memory/\` | Facts, context and decisions (\`decisions.md\`); \`docs/\` is read on demand. |\n| \`shared/\` | Brett's files for every project. |\n`, made);
  writeNew(join(cl, 'rules', 'RULES.md'), `# Rules: ${project.name}\n\nHard rules for this project. The shared rules in \`shared/rules/\` apply too.\n`, made);
  writeNew(join(cl, 'instructions', 'README.md'), `# Instructions\n\nHow to work on ${project.name}: procedures, checklists, deploy guides.\n`, made);
  writeNew(join(cl, 'memory', 'README.md'), `# Memory\n\nFacts and decisions about ${project.name}. Decisions go in \`decisions.md\`.\n`, made);
  writeNew(join(cl, 'memory', 'decisions.md'), `# Decisions\n\n- ${today}: project created in the console (projects@1)${by ? ` by ${by}` : ''}${project.repo ? `; linked repo ${project.repo}` : ''}${project.skin ? `; skin ${project.skin}` : ''}${seed === 'demo' ? '; started with demo data' : ''}.\n`, made);
  writeNew(join(cl, 'memory', `${name}.md`), `# ${project.name}\n\n${project.description || 'What it is: to be written by the first session.'}\n\n- Project id: ${name} (build profile ${project.profile})\n- Repo: ${project.repo || 'none linked'}\n- Skin: ${project.skin || 'the console default'}\n`, made);
  return { dir, manifestFile: manifestFile(name), manifest: readJson(manifestFile(name)) ?? manifest, validation, made };
}
