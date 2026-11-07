/**
 * Listeners (`ai.amberx.axf.listeners`, web): the pure rules behind AmberX's background listeners (listener@1):
 * registry, per-listener policy, restart backoff and give-up, silent restarts, yielding the microphone, one mic owner,
 * the device document the console reads. Everything lives in `./core.ts`; this library adds nothing to the runtime.
 *
 *   import { afterEnd, yieldReason, policyFrom, deviceDoc } from '<app>/axf/libs/listeners';
 */
import type { AxfWebLibrary } from '../../react/library';

export * from './core';

export const listenersLibrary: AxfWebLibrary = {
  id: 'ai.amberx.axf.listeners',
  label: 'Listeners',
  version: '0.1.0',
};
