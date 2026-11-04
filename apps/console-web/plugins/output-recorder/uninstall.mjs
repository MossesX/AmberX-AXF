#!/usr/bin/env node
/**
 * Audio Output Recorder uninstaller (plugin-lifecycle@1). It keeps no data on the console; recordings stay on axHub
 * (hub project `amberx-recordings`, they're the person's) and fetched copies in the phone's Music/AmberX Recorder.
 * --all removes this folder and its doc lines.
 *   node apps/console-web/plugins/output-recorder/uninstall.mjs [--all] [--dry-run] [--json]
 * Then: node framework/cli/plugin-lifecycle.mjs check output-recorder --after-uninstall
 * The native half (OutputRecorderPlugin.java, OutputRecordService.java, OutputRecordUploader.java, OutputRecordQueue.java,
 * OutputRecordStartActivity.java, OutputRecordTile.java in apps/amberx-droid/android) is part of the AmberX shell, like
 * Audio Extract's: it stays in the APK and records nothing unless the switch or the tile is turned on.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'output-recorder');
