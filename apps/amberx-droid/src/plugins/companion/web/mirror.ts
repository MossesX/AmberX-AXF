/**
 * A copy of every Gizmo chat on axHub (Settings → Plugins → Gizmo → "Keep a copy of my chats on axHub", on by default):
 * the live chat is the assistant's on the VPS; after each reply the conversation's text (no images, no tool payloads)
 * is written to the hub's data server through lib-hubstore, hub project `amberx-axf`, folder `companion`, table `chats`
 * (/projects/amberx-axf/_data/companion/chats), so any device and any Claude session can read it. Deleting a chat
 * deletes its copy.
 */
import type { Conversation } from '../../../axf/core';
import { chatCopy, MIRROR } from './core';
import { HubData, type Row, type Table } from '../../../axf/libs/hubstore';
import { HUB } from '../../../hub/useHub';
import { COMPANION_ID } from './api';

export { MIRROR, chatCopy, type ChatCopy } from './core';

let table: Table | null = null;
function chats() {
  table ??= new HubData({ hub: HUB, project: MIRROR.project, folder: MIRROR.folder, mode: 'all', appId: COMPANION_ID }).table(MIRROR.table);
  return table;
}
/** Write a chat's copy; never throws (the hub may be unreachable: the chat itself is safe on the VPS). */
export async function mirrorChat(c: Conversation): Promise<boolean> {
  try { await chats().put(c.id, chatCopy(c) as unknown as Row); return true; } catch { return false; }
}
export async function forgetChat(id: string): Promise<void> {
  try { await chats().remove(id); } catch { /* the hub copy goes on the next delete */ }
}
