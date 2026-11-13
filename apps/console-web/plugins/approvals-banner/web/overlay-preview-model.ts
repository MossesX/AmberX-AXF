/**
 * The overlay toolbar preview (Brett, Nov 13 2026: see the always-on overlay toolbar before the APK exists). Pure data:
 * the three design options offered in UI Review and the three states every option is shown in. The option Brett picks
 * becomes the spec for the Android build (AmberX `ApprovalOverlay`), so each option says, in words, how big the toolbar
 * is, where it sits and what it holds, next to the picture.
 */

export type PreviewOption = 'pill' | 'rail' | 'bubble';
export type PreviewState = 'collapsed' | 'approval' | 'expanded';

export interface PreviewOptionSpec {
  id: PreviewOption;
  /** tab label */ label: string;
  /** one line: shape, size and place */ summary: string;
  /** the spec lines the Android build follows, one per state */
  spec: Record<PreviewState, string>;
}

export const PREVIEW_OPTIONS: readonly PreviewOptionSpec[] = [
  {
    id: 'pill',
    label: 'A · Pill',
    summary: 'A short horizontal pill on the right edge, 30 % down: grip, mic, approvals, page. About 4 icons wide, one row high.',
    spec: {
      collapsed: 'Pill on the right edge, 30 % from the top, dimmed to the idle opacity. Drag the grip to move it up or down.',
      approval: 'The pill lights up and a card drops from it, nearly full width: what, why, countdown bar, Deny / Approve and a link to the approvals page.',
      expanded: 'Full screen: the pill docks top-left in the browser bar, next to the address; the page Amber drives fills the rest.',
    },
  },
  {
    id: 'rail',
    label: 'B · Rail',
    summary: 'A slim vertical rail hugging the right edge, 30 % down: the same four icons stacked. One icon wide, out of the way of content.',
    spec: {
      collapsed: 'Rail flush with the right edge, rounded on the inside only, so it reads as a tab you can pull. Drag it up or down.',
      approval: 'A bar rises from the bottom of the screen, full width, thumb-reachable: countdown, Deny / Approve, approvals page link. The rail stays.',
      expanded: 'Full screen: the rail docks top-left and runs down the left side; the address bar and page sit to its right.',
    },
  },
  {
    id: 'bubble',
    label: 'C · Bubble',
    summary: 'One round button in the bottom-right corner with Amber\'s mark; a badge counts what waits. Smallest footprint, one tap opens the rest.',
    spec: {
      collapsed: 'Bubble bottom-right, above the navigation bar. Tap: mic, approvals, page fan out beside it. Drag it anywhere.',
      approval: 'A heads-up bar drops in at the top of the screen, like a notification but in the skin: countdown, Deny / Approve, approvals page link. The bubble shows the count.',
      expanded: 'Full screen: the bubble docks top-left with its actions in a short strip beside it; the address bar and page sit below.',
    },
  },
] as const;

export const PREVIEW_STATES: readonly { id: PreviewState; label: string }[] = [
  { id: 'collapsed', label: 'Collapsed' },
  { id: 'approval', label: 'Approval waiting' },
  { id: 'expanded', label: 'Expanded' },
] as const;

/** The sample call the approval states show (made up; nothing is sent). */
export const SAMPLE_CALL = {
  title: 'Restart the console',
  why: 'Loads the new Overlay settings tab.',
  command: 'systemctl restart axf-console',
  from: 'Headless · overlay-preview',
  seconds: 90,
} as const;

/** The page the expanded state's browser shows Amber driving (made up). */
export const SAMPLE_PAGE = { url: 'console.amberxai.com/builds', title: 'Builds', doing: 'Amber is opening the Builds page' } as const;

/** mm:ss for a countdown. */
export const clock = (s: number): string => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

export const optionSpec = (id: PreviewOption): PreviewOptionSpec => PREVIEW_OPTIONS.find((o) => o.id === id) ?? (PREVIEW_OPTIONS[0] as PreviewOptionSpec);

export const isOption =(v: unknown): v is PreviewOption => PREVIEW_OPTIONS.some((o) => o.id === v);
export const isState = (v: unknown): v is PreviewState => PREVIEW_STATES.some((s) => s.id === v);
