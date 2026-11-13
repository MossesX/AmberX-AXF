/*
 * The note on every area "Get my skin only from axHub" greys out (Brett, Nov 13 2026: "every screen where you'd change
 * properties is greyed out with a note saying you can't edit this, but click here if you insist, and it will no longer
 * refresh and inherit its data from axHub"). One component, so the wording and the override path are the same
 * everywhere: Settings → Appearance, the skin picker, every-asset picker, Token Control, UI Manager, plugin themes.
 */
import { HUB_SKIN_LOCK_NOTE, HUB_SKIN_OVERRIDE_CONFIRM, type AxfRuntime } from '../../core';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Button } from './Controls';
import { Note } from './Forms';

/** Ask once, then turn Override on (axHub-only off, editing unlocked). False when the user said no. */
export function askHubSkinOverride(rt: AxfRuntime): boolean {
  if (typeof globalThis.confirm === 'function' && !globalThis.confirm(HUB_SKIN_OVERRIDE_CONFIRM)) return false;
  return rt.setHubSkinOverride(true);
}

/** The lock note with its "Click here to override" link. Draws nothing unless Skin from axHub only locks the look. */
export function HubSkinLockNote({ className }: { className?: string }) {
  const rt = useRuntime();
  useAxfState();
  if (rt.appearanceLockReason() !== 'hub') return null;
  return (
    <Note tone="info" icon="lock" className={`axf-hubskin-lock ${className ?? ''}`}>
      <span data-axf-hubskin-lock="">{HUB_SKIN_LOCK_NOTE} </span>
      <Button tone="ghost" size="sm" icon="edit" data-axf-hubskin-override="" disabled={!rt.mayChangeLook()} onClick={() => { askHubSkinOverride(rt); }}>Click here to override</Button>
    </Note>
  );
}
