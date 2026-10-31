export const FOLDER = 'ui-review';
export const ID = 'ai.amberx.axf.console.ui-review';
export const VIEW = 'ui-review';
/** View → Design packs: the same page, opened on its Design packs section. */
export const PACKS_VIEW = 'design-packs';
export const KEYS = {
  view: 'ui-review.view', sort: 'ui-review.sort', groupBy: 'ui-review.groupBy', section: 'ui-review.section',
  status: 'ui-review.status', device: 'ui-review.device', thumbs: 'ui-review.thumbs',
} as const;
export const VIEWS = [
  { id: 'grid', label: 'Grid', icon: 'list' },
  { id: 'tree', label: 'Tree', icon: 'layers' },
  { id: 'groups', label: 'Sub-grids', icon: 'grid' },
  { id: 'gallery', label: 'Gallery', icon: 'layout' },
  { id: 'compare', label: 'Compare', icon: 'copy' },
] as const;
export type ViewId = (typeof VIEWS)[number]['id'];
export const GROUP_BYS = [{ id: 'kind', label: 'Kind' }, { id: 'app', label: 'App' }, { id: 'status', label: 'Status' }, { id: 'build', label: 'Build / branch' }] as const;
export type GroupBy = (typeof GROUP_BYS)[number]['id'];
