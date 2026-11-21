/** Lifecycle hooks (plugin-lifecycle@1) for Audio Output Recorder: self-checks only (it keeps no data on the console). */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const HERE = 'apps/console-web/plugins/output-recorder';

export async function checks(ctx) {
  return [
    { id: 'transcripts-worker', ok: existsSync(join(ctx.root, HERE, 'server', 'transcripts.py')), detail: `${HERE}/server/transcripts.py` },
    { id: 'recordings-page', ok: existsSync(join(ctx.root, HERE, 'web', 'index.tsx')), detail: `${HERE}/web/index.tsx` },
  ];
}
