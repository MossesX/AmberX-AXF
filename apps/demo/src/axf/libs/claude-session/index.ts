/**
 * Claude session (`ai.amberx.axf.claude-session`, web): shared session parts for the console Terminal and AmberX's
 * companion (Gizmo). Everything is pure and lives in `./core.ts`; this library adds nothing to the runtime.
 *
 *   import { modelName, money, speakable, groupConversations } from '<app>/axf/libs/claude-session';
 */
import type { AxfWebLibrary } from '../../react/library';

export * from './core';

export const claudeSessionLibrary: AxfWebLibrary = {
  id: 'ai.amberx.axf.claude-session',
  label: 'Claude session',
  version: '0.1.0',
};
