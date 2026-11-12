/** Application-menu entries of the GitHub client (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'github-client.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 12, items: [{ id: 'github-client', label: 'GitHub client', icon: 'github', items: [
    { id: 'github-client-prs', label: 'Pull requests', icon: 'github', action: 'nav:github-client' },
    { id: 'github-client-ready', label: 'Ready to merge', icon: 'check', action: 'github-client.focus:prs%20ready' },
    { id: 'github-client-batch', label: 'Batch merge…', icon: 'layers', action: 'github-client.batch' },
    { id: 'github-client-branches', label: 'Branches', icon: 'branch', action: 'github-client.focus:branches' },
    { id: 'github-client-commits', label: 'Commits', icon: 'list', action: 'github-client.focus:commits' },
    { id: 'github-client-log', label: 'Git log', icon: 'clock', action: 'github-client.focus:log' },
  ] }] },
  { id: 'github-client.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'github-client', label: 'GitHub client', icon: 'github', action: 'settings.open:plugins/github-client' }] },
];
