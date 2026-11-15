/*
 * Skin editor → the axHub skin library. axHub's data server takes this browser's hub session (not the console token), so
 * the server queues every export (page, REST, MCP, CLI, voice) and the page sends the queue: each skin becomes a row of
 * the hub table the server names (project `shared`, folder `skin-library`, table `skins`), then the server is told how
 * it went. A skin that failed stays failed until it is sent again (POST /skins/{id}/hub), so nothing loops.
 */
import { createHubData, type Row } from '@console/axf/libs/hubstore';
import * as api from './api';

let running: Promise<{ sent: number; failed: number; error: string }> | null = null;

export function sendQueuedToHub(): Promise<{ sent: number; failed: number; error: string }> {
  running ??= (async () => {
    let sent = 0; let failed = 0; let error = '';
    try {
      const box = await api.hub();
      const queued = box.items.filter((i) => i.status === 'queued');
      if (!queued.length) return { sent, failed, error };
      const table = createHubData({ project: box.project, folder: box.folder, mode: 'all' }).table<Row>(box.table);
      for (const item of queued) {
        try {
          const asset = await api.skin(item.id);
          await table.put(item.id, asset as unknown as Row);
          await api.hubResult(item.id, { ok: true });
          sent++;
        } catch (e) {
          error = (e as Error).message;
          failed++;
          await api.hubResult(item.id, { ok: false, error }).catch(() => undefined);
        }
      }
    } catch (e) { error = (e as Error).message; }
    return { sent, failed, error };
  })().finally(() => { running = null; });
  return running;
}
