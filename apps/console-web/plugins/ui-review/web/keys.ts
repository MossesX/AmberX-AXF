export const FOLDER = 'ui-review';
export const ID = 'ai.amberx.axf.console.ui-review';
export const VIEW = 'ui-review';
/** View → Design packs: the same page, opened on its Design packs section. */
export const PACKS_VIEW = 'design-packs';
/** View → Screenshots: the same page, opened on its Screenshots tab (ad-hoc pictures, not waiting for approval). */
export const SHOTS_VIEW = 'ui-screenshots';
/** A copied screenshot link: ?ui-shot=<id> opens UI Review → Screenshots on that picture. */
export const SHOT_PARAM = 'ui-shot';
/** A build's predicted look (?ui-mockup=<ui-mockup@1>): framework/cli/ui-predict.mjs captures this page. */
export const MOCKUP_VIEW = 'ui-mockup';
export const KEYS = {
  view: 'ui-review.view', sort: 'ui-review.sort', groupBy: 'ui-review.groupBy', section: 'ui-review.section',
  status: 'ui-review.status', device: 'ui-review.device', thumbs: 'ui-review.thumbs',
  tab: 'ui-review.tab', pinWaiting: 'ui-review.pinWaiting', listBy: 'ui-review.listBy', shotGroup: 'ui-review.shotGroup', shotMode: 'ui-review.shotMode', compare: 'ui-review.compare',
} as const;
export const VIEWS = [
  { id: 'grid', label: 'Grid', icon: 'list' },
  { id: 'tree', label: 'Tree', icon: 'layers' },
  { id: 'groups', label: 'Sub-grids', icon: 'grid' },
  { id: 'gallery', label: 'Gallery', icon: 'layout' },
  { id: 'compare', label: 'Compare', icon: 'copy' },
] as const;
export type ViewId = (typeof VIEWS)[number]['id'];
export const GROUP_BYS = [{ id: 'pr', label: 'PR' }, { id: 'date', label: 'Date added' }, { id: 'build', label: 'Build / branch' }, { id: 'kind', label: 'Type' }, { id: 'app', label: 'App' }, { id: 'status', label: 'Status' }] as const;
/** The list's sort / group switch (Brett, Nov 4 2026): By PR · By date · By build · By type; '' = one flat list. */
export const LIST_BYS = [{ id: '', label: 'Flat list' }, { id: 'pr', label: 'By PR' }, { id: 'date', label: 'By date' }, { id: 'build', label: 'By build' }, { id: 'kind', label: 'By type' }] as const;
export type ListBy = (typeof LIST_BYS)[number]['id'];
export type GroupBy = (typeof GROUP_BYS)[number]['id'];
