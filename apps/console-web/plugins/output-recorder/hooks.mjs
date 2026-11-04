/** Lifecycle hooks (plugin-lifecycle@1) for Audio Output Recorder: self-checks only (it keeps no data on the console). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const JAVA = 'apps/amberx-droid/android/app/src/main/java/ai/amberx/droid';
const MANIFEST = 'apps/amberx-droid/android/app/src/main/AndroidManifest.xml';

export async function checks(ctx) {
  const manifest = existsSync(join(ctx.root, MANIFEST)) ? readFileSync(join(ctx.root, MANIFEST), 'utf8') : '';
  const service = existsSync(join(ctx.root, JAVA, 'OutputRecordService.java')) ? readFileSync(join(ctx.root, JAVA, 'OutputRecordService.java'), 'utf8') : '';
  return [
    { id: 'native-plugin', ok: existsSync(join(ctx.root, JAVA, 'OutputRecorderPlugin.java')), detail: `${JAVA}/OutputRecorderPlugin.java` },
    { id: 'capture-service', ok: manifest.includes('.OutputRecordService') && manifest.includes('mediaProjection'), detail: 'OutputRecordService, foregroundServiceType mediaProjection' },
    { id: 'tile', ok: manifest.includes('.OutputRecordTile') && manifest.includes('QS_TILE'), detail: 'quick-settings tile “Record audio out”' },
    { id: 'no-microphone', ok: !!service && service.includes('setAudioPlaybackCaptureConfig') && !/setAudioSource|AudioSource\.MIC|MediaRecorder/.test(service), detail: 'playback capture only, no audio source' },
  ];
}
