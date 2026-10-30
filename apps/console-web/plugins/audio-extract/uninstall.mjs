#!/usr/bin/env node
/**
 * Audio Extract uninstaller (plugin-lifecycle@1). It keeps no data on the console; audio files stay in the phone's
 * Music folder (they're the person's files). --all removes this folder and its doc lines.
 *   node apps/console-web/plugins/audio-extract/uninstall.mjs [--all] [--dry-run] [--json]
 * Then: node framework/cli/plugin-lifecycle.mjs check audio-extract --after-uninstall
 * The native half (AudioExtractPlugin.java, ScreenRecordService.java in apps/amberx-droid/android) is part of the AmberX
 * shell, like AmberxNativePlugin: it stays in the APK and does nothing without this page.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'audio-extract');
