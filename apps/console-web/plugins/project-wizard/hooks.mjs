/**
 * Lifecycle hooks (plugin-lifecycle@1). The wizard keeps its records in ctx.dataDir/projects.json.
 *
 * Project data (project-template@1): a copy of a project carries the wizard's part of it: the setup (starter code,
 * framework, skin, Claude account and models), the manifest under the new name, and the project's own rules and
 * instructions. A copied workspace keeps them until the wizard links it to a repo; "Start from" in the wizard writes
 * them into the new repo itself.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const projectDataLabel = 'Project setup';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('removing the project wizard records; the projects it made keep their repos and workspaces'); }
export async function checks(ctx) {
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'claude-project', ok: existsSync(join(ctx.root, 'framework', 'cli', 'claude-project.mjs')), detail: 'framework/cli/claude-project.mjs' },
  ];
}

export async function exportProjectData(ctx) {
  const { exportPart } = await import('./wizard.mjs');
  return exportPart(ctx.project);
}

export async function importProjectData(ctx, data) {
  const { importPart } = await import('./wizard.mjs');
  return importPart(ctx.project, data);
}
