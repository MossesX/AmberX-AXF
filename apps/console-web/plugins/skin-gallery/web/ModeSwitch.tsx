/**
 * Quick light / dark switch for the skin in force, Default included (skin-modes@1, Brett: "every skin needs a light and
 * dark"): Light, Dark or System (follow the device). It runs the console action `skin.mode:<mode>`, the same one voice,
 * console_action and the theme-manager route POST /skins/{app}/mode reach.
 */
import { Segmented, useAxfState, useRuntime, type SegmentedOption } from '@console/axf/react';

type Mode = 'light' | 'dark' | 'system';
const OPTIONS: SegmentedOption<Mode>[] = [
  { value: 'light', label: 'Light', icon: 'sun', title: 'Use this skin\'s light colour theme' },
  { value: 'dark', label: 'Dark', icon: 'moon', title: 'Use this skin\'s dark colour theme' },
  { value: 'system', label: 'System', icon: 'monitor', title: 'Follow the device\'s light / dark setting' },
];

export function ModeSwitch({ className }: { className?: string }) {
  const rt = useRuntime();
  useAxfState(); // redraw when the colour theme in force changes
  const st = rt.skinModeState();
  const value: Mode = st.mode === 'system' ? 'system' : st.scheme === 'dark' ? 'dark' : 'light';
  const name = st.skin === 'default' ? 'Default' : st.skin;
  return (
    <Segmented<Mode> size="sm" className={className} label={`Light or dark for ${name}`} value={value} options={OPTIONS}
      disabled={rt.lockedByAppearance('assets.swap') || !st.light || !st.dark}
      onChange={(m) => { rt.actions.dispatch(`skin.mode:${m}`, { runtime: rt }); }} />
  );
}
