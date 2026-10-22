/**
 * Where projects live, on lib-docstore: always this device, and with "Keep projects on axHub" also the hub's data server
 * (/data/walkthrough-studio/projects/<id>/head.json + chunk-<n>.json, the pieces split under the 64 KB limit). Screen
 * video stays on the device (lib-docstore's blob store). Older studio saves (`ws:project:*`) move over once.
 */
import { createDocStore, type DocStore, type DocSummary } from '../axf/libs/docstore';
import { normalizeProject, type Piece, type Project } from './model';

export type ProjectSummary = DocSummary & { pieces?: number };
export const HUB_PROJECT = 'walkthrough-studio';

export function projectStore(hub: string, hubOn: boolean): DocStore<Project> {
  migrateOldSaves();
  return createDocStore<Project>({
    folder: 'projects', hub, project: HUB_PROJECT, hubOn, parse: normalizeProject,
    shape: {
      // recordings keep their events on the hub, never the device-only video key
      split: ({ pieces, recordings, ...head }) => ({ head: { ...head, recordings: recordings.map(({ videoKey: _v, ...r }) => r) }, items: pieces }),
      join: (head, items) => ({ ...(head as unknown as Project), pieces: items as Record<string, Piece> }),
    },
  });
}
export const summary = (p: Project): Partial<ProjectSummary> => ({ pieces: Object.keys(p.pieces).length });

function migrateOldSaves() {
  try {
    const old = JSON.parse(localStorage.getItem('ws:projects') ?? 'null') as { id: string; name: string; updatedAt: string; pieces: number }[] | null;
    if (!old) return;
    const index: ProjectSummary[] = JSON.parse(localStorage.getItem('axf-docs:projects') ?? '[]');
    for (const s of old) {
      const raw = localStorage.getItem(`ws:project:${s.id}`);
      if (raw && !index.some((x) => x.id === s.id)) { localStorage.setItem(`axf-docs:projects:${s.id}`, raw); index.push({ ...s, where: 'device' }); }
      localStorage.removeItem(`ws:project:${s.id}`);
    }
    localStorage.setItem('axf-docs:projects', JSON.stringify(index));
    localStorage.removeItem('ws:projects');
  } catch { /* nothing to move */ }
}
