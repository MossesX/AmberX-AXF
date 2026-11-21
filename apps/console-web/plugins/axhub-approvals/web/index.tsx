/**
 * axHub approvals (console plugin, module axHub): The hub's approvals inside the console: every request axHub has asked about (pending and held calls first), decided here through the console's hub-pages relay with a hub session, never the console token; one request's page with the complete call, history, postpone (time, date or condition) and every action it allows; held calls (veto@1) with the live countdown, Deny, Approve now and Shelve; the auto-approve window; the approvals log with calls that ran under a pass.
 *
 * The pages share the console's hub-pages kit (src/hubPages: the relay client, the sign-in gate, the routes); no
 * axHub plugin imports another's folder, and a page whose plugin isn't installed says so instead of opening.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { go } from '@console/hubPages/route';
import { Approvals } from './Approvals';
import { ApprovalDetail } from './ApprovalDetail';
import { ApprovalLog } from './ApprovalLog';
import { APPROVAL_ID_RE } from '@console/hubPages/core';
import './axhub-approvals.css';
import { appMenu } from './menu';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.axhub-approvals',
  label: 'axHub approvals',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('axhub-approvals.open', () => go(rt, 'home'), { label: "Open the hub's approvals" });
    rt.actions.register('axhub-approvals-log.open', () => go(rt, 'approvals-log'), { label: "Open the approvals log" });
    // A request id from anywhere (a notice, the approvals banner, a search hit) opens its page here, not on the hub.
    rt.actions.register('hub.review', ([id]) => { if (id && APPROVAL_ID_RE.test(id)) go(rt, 'approval', { id }); }, { label: 'Review the request', params: true });
  },
  views: {
    'axhub-approvals': { title: 'Approvals', icon: 'shield', keywords: ["approval", "waiting", "confirm", "axhub"], render: () => <Approvals /> },
    'axhub-approval': { title: 'Request', icon: 'shield', keywords: ["request", "approval"], render: () => <ApprovalDetail /> },
    'axhub-approvals-log': { title: 'Approvals log', icon: 'list', keywords: ["log", "history", "auto-approve"], render: () => <ApprovalLog /> },
  },
  nav: { label: 'System', items: [{ id: 'axhub-approvals', label: 'Approvals', icon: 'shield', view: 'axhub-approvals' }, { id: 'axhub-approvals-log', label: 'Approvals log', icon: 'list', view: 'axhub-approvals-log' }] },
};
