/** Lifecycle hooks (plugin-lifecycle@1) for Audio Extract: self-checks only (it keeps no data on the console). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const JAVA = 'apps/amberx-droid/android/app/src/main/java/ai/amberx/droid';
const MANIFEST = 'apps/amberx-droid/android/app/src/main/AndroidManifest.xml';

export async function checks(ctx) {
  const manifest = existsSync(join(ctx.root, MANIFEST)) ? readFileSync(join(ctx.root, MANIFEST), 'utf8') : '';
  return [
    { id: 'native-plugin', ok: existsSync(join(ctx.root, JAVA, 'AudioExtractPlugin.java')), detail: `${JAVA}/AudioExtractPlugin.java (MediaExtractor + MediaMuxer)` },
    { id: 'recorder-service', ok: manifest.includes('.ScreenRecordService') && manifest.includes('mediaProjection'), detail: 'ScreenRecordService, foregroundServiceType mediaProjection' },
    { id: 'share-target', ok: manifest.includes('android.intent.action.SEND') && manifest.includes('video/*'), detail: 'Share → AmberX for videos' },
  ];
}
