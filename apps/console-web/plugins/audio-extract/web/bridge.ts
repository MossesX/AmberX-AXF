/**
 * The native side of Audio Extract: the `AudioExtract` Capacitor plugin in the AmberX Android shell
 * (apps/amberx-droid/android/…/AudioExtractPlugin.java + ScreenRecordService.java). Every method here has its twin there.
 *
 * The plugin needs no Capacitor import: AmberX's page carries the Capacitor global (`window.Capacitor`), and the plugin
 * is looked up through it. Anywhere else (a browser, the Dev Console, an older APK without the plugin) `nativeBridge()`
 * is null and the page says what's needed. There is no browser stand-in: extraction is native or it doesn't happen.
 */
import type { AudioFile, AudioFormat, AudioTrack, NativeRec, RecorderSettings, Video } from './core';

export interface Handle { remove(): Promise<void> | void }

export interface ExtractOptions {
  jobId: string;
  uri: string;
  /** audio track index in the video (-1 = the first audio track) */
  track: number;
  format: AudioFormat;
  startMs: number;
  /** -1 = to the end */
  endMs: number;
  /** Music/<folder> */
  folder: string;
  /** file name with its extension */
  name: string;
}

export interface AudioExtractBridge {
  /** Android's file picker (videos only); several at once when `multiple`. */
  pickVideos(o: { multiple: boolean }): Promise<{ videos: Video[] }>;
  /** Length and audio tracks of a video. */
  probe(o: { uri: string }): Promise<{ durationMs: number; tracks: AudioTrack[] }>;
  /** Extract one video's audio into Music/<folder>/<name>. Resolves when it's saved; `progress` events meanwhile. */
  extract(o: ExtractOptions): Promise<AudioFile>;
  /** Stop a running extract (its half-written file is removed). */
  cancel(o: { jobId: string }): Promise<void>;
  /**
   * Screen-recording folders AmberX may read: each is granted once through Android's folder picker (no storage
   * permission). Samsung writes to DCIM/Screen recordings, Pixel to Movies/Screen recordings.
   */
  folders(): Promise<{ folders: { uri: string; name: string }[] }>;
  /** Android's folder picker, opened at the screen-recordings folder; the grant is kept. */
  addFolder(): Promise<{ folder: { uri: string; name: string } }>;
  removeFolder(o: { uri: string }): Promise<void>;
  /** The newest video in the granted folders (null when there's none). Rejects with code `no-folder` when none is granted. */
  latestRecording(): Promise<{ video: Video | null }>;
  /** Watch the granted folders while AmberX runs (checked every few seconds); `newRecording` events. */
  watch(o: { on: boolean }): Promise<void>;
  /** Videos shared to AmberX (Share → AmberX) that haven't been handed over yet. */
  takeShared(): Promise<{ videos: Video[] }>;
  /** Audio files in Music/<folder>, newest first. */
  list(o: { folder: string }): Promise<{ files: AudioFile[] }>;
  rename(o: { uri: string; name: string }): Promise<{ name: string }>;
  /** Deletes an audio file AmberX made. */
  remove(o: { uri: string }): Promise<void>;
  /** Deletes a video. A video AmberX didn't make goes through Android's own "Allow AmberX to delete?" prompt. */
  deleteVideo(o: { uri: string }): Promise<{ deleted: boolean }>;
  play(o: { uri: string }): Promise<void>;
  share(o: { uri: string; mime?: string }): Promise<void>;

  /** Screen recorder: asks Android for screen capture (every time), then counts down and records. */
  recordStart(o: RecorderSettings & { folder: string }): Promise<void>;
  recordPause(): Promise<void>;
  recordResume(): Promise<void>;
  /** Stops (or cancels the countdown); the `recorder` event `stopped` carries the video. */
  recordStop(): Promise<void>;
  /** Notification permission (Android 13+) for the recorder's notification. */
  notifications(): Promise<{ granted: boolean }>;
  /** "Display over other apps", needed by the floating chip only. */
  overlay(): Promise<{ allowed: boolean }>;

  addListener(event: 'progress', fn: (e: { jobId: string; progress: number }) => void): Promise<Handle>;
  addListener(event: 'newRecording', fn: (e: { video: Video }) => void): Promise<Handle>;
  addListener(event: 'shared', fn: (e: { videos: Video[] }) => void): Promise<Handle>;
  addListener(event: 'recorder', fn: (e: NativeRec) => void): Promise<Handle>;
}

type CapacitorGlobal = {
  isPluginAvailable?: (name: string) => boolean;
  registerPlugin?: <T>(name: string) => T;
  getPlatform?: () => string;
};

let cached: AudioExtractBridge | null | undefined;
let override: AudioExtractBridge | null | undefined;

/** The native plugin, or null when AmberX's Android shell (with this plugin) isn't what's running the page. */
export function nativeBridge(): AudioExtractBridge | null {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  cached = cap?.getPlatform?.() === 'android' && cap.isPluginAvailable?.('AudioExtract') && cap.registerPlugin
    ? cap.registerPlugin<AudioExtractBridge>('AudioExtract') : null;
  return cached;
}

/** Tests: run against a fake bridge (null = no native side). */
export function setBridge(b: AudioExtractBridge | null | undefined): void { override = b; }
