/** Lifecycle hooks (plugin-lifecycle@1): demos, pitch facts, recordings and settings live only in ctx.dataDir. */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  for (const d of ['demonstration', 'pitch', 'clip', 'media']) mkdirSync(join(ctx.dataDir, d), { recursive: true });
  process.env.AXF_DEMO_DESIGNER_DIR = ctx.dataDir;
  const { findFfmpeg } = await import('./demos.mjs');
  const ff = findFfmpeg();
  ctx.log(`ready: ${ctx.dataDir}; MP4 export ${ff ? `through ${ff}` : 'needs ffmpeg (recordings stay WebM until it is installed or AXF_FFMPEG is set)'}`);
}
export async function onUninstall(ctx) { ctx.log('removing the saved demos, recordings and settings'); }
export async function checks(ctx) {
  process.env.AXF_DEMO_DESIGNER_DIR = ctx.dataDir;
  const { findFfmpeg } = await import('./demos.mjs');
  return [
    { id: 'data-folder', ok: existsSync(join(ctx.dataDir, 'demonstration')), detail: join(ctx.dataDir, 'demonstration') },
    { id: 'ffmpeg', ok: !!findFfmpeg(), detail: findFfmpeg() || 'no ffmpeg: video export stays WebM (install ffmpeg or set AXF_FFMPEG)' },
  ];
}
