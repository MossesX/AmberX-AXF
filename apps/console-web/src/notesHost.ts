/**
 * Host seam for the shared Notes and tasks plugin: what differs between the apps that load it. The console's copy is
 * this file; AmberX aliases `@console/notesHost` to `src/console/notesHost.ts`. The plugin never imports an app file.
 */
import { hubOrigin } from './hubAppearance';

/** The nav group the plugin's pages sit in. */
export const NAV_GROUP = 'Plugins';
/** The hub the shared store lives on; '' or 'off' = this app runs without a hub. */
export const hubAddress = (): string => hubOrigin();
export function openHubSignIn(url: string): void { window.open(url, '_blank', 'noopener'); }
/** Summarize in the item editor: AmberX's AI connection only, off here. */
export const useSummarizer = (): { ok: boolean } => ({ ok: false });
export async function summarize(_text: string): Promise<{ title: string; summary: string; tags: string[] } | null> { return null; }
/** Every plugin that gets its own list. Only AmberX keeps one list per plugin. */
export async function listedPlugins(): Promise<{ id: string; name: string }[] | null> { return null; }
