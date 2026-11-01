/**
 * Demo data for the AmberX walkthrough recording (walkthrough-video@1). Nothing here is real: a made-up account
 * ("Demo"), made-up notes, tasks and approvals. The recorder (record.mjs) serves these files in place of axHub's data
 * server and approvals feed, so no real note, approval, session or key can reach a frame, and every write the app
 * tries is answered here and never leaves the recording browser.
 *
 * Built with the app's own notes core, so the rows are exactly what AmberX writes itself.
 *   npx -y tsx apps/amberx-droid/walkthrough/seed.mts [out.json]     (default: prints to stdout)
 */
import { writeFileSync } from 'node:fs';
import { addItem, addList, emptyStore, ensureSystemLists, DATA_FOLDER, HUB_PROJECT, ITEMS_TABLE, LISTS_TABLE, VOICE_NOTES_FOLDER, type Store } from '../src/plugins/notes/web/core';

export const DEMO_USER = 'Demo';
const now = new Date();
const iso = (minsAgo: number) => new Date(now.getTime() - minsAgo * 60_000).toISOString();
const day = (plus: number) => new Date(now.getTime() + plus * 86_400_000).toISOString().slice(0, 10);

function notes(): Store {
  const s = emptyStore(iso(60 * 24 * 7));
  ensureSystemLists(s, iso(60 * 24 * 7));
  const work = addList(s, 'Work', null, iso(9000));
  const ideas = addList(s, 'Ideas', null, iso(9000));
  const home = addList(s, 'Home', null, iso(9000));
  const shop = addList(s, 'Groceries', home.id, iso(9000));
  const by = { by: DEMO_USER, device: 'phone-demo' };
  const add = (x: Parameters<typeof addItem>[1], mins: number) => addItem(s, { ...by, ...x } as Parameters<typeof addItem>[1], iso(mins));
  add({ kind: 'note', list: 'inbox', title: 'Call the print shop about the flyers', text: 'Call the print shop about the flyers before Friday.', source: 'voice', transcript: 'note call the print shop about the flyers before friday' }, 35);
  add({ kind: 'note', list: ideas.id, title: 'Weekend market stall', text: 'A stall at the weekend market: sell the extra prints, bring the card reader.', tags: ['side-project'], pinned: true, source: 'voice' }, 300);
  add({ kind: 'note', list: ideas.id, title: 'Podcast episode outline', text: 'Intro, three tips for small shops, listener question, wrap.', starred: true, source: 'typed' }, 1500);
  add({ kind: 'note', list: work.id, title: 'Team meeting notes', text: 'Launch moves to the 14th. Sam owns the landing page. Next check-in Thursday.', tags: ['meeting'], source: 'typed' }, 2900);
  add({ kind: 'note', list: work.id, title: 'Landing page copy', text: 'Headline: Get it done by voice. Sub: notes, tasks and approvals in one place.', source: 'ai', summary: 'Draft copy for the launch page.' }, 4000);
  add({ kind: 'task', list: work.id, title: 'Send the launch email', due: day(0), priority: 3, source: 'voice' }, 120);
  add({ kind: 'task', list: work.id, title: 'Review the landing page', due: day(1), priority: 2, source: 'typed', checklist: [{ id: 'c1', text: 'Headline', done: true }, { id: 'c2', text: 'Pricing table', done: false }, { id: 'c3', text: 'Phone layout', done: false }] }, 600);
  add({ kind: 'task', list: home.id, title: 'Book the car service', due: day(3), priority: 1, source: 'voice' }, 2000);
  add({ kind: 'todo', list: shop.id, title: 'Milk', source: 'voice' }, 50);
  add({ kind: 'todo', list: shop.id, title: 'Coffee beans', source: 'voice' }, 50);
  add({ kind: 'todo', list: shop.id, title: 'Lemons', source: 'voice' }, 49);
  return s;
}

const table = (name: string, rows: Record<string, unknown>) => ({ $axf: 'hub-table@1', table: name, count: Object.keys(rows).length, updatedAt: iso(5), chunks: 0, rows });

/** Approvals feed (axHub `/auth/admin/approvals.json`): one held veto call and two waiting for an approval. */
function approvals() {
  const hub = 'https://axhub.amberxai.com';
  const mk = (n: number) => `0000000${n}-dem0-4000-8000-00000000000${n}`.replace('dem0', 'de00');
  const runsIn = 75;
  return {
    signedIn: true, admin: true, count: 3, heldCount: 1,
    pending: [
      {
        id: mk(1), tool: 'vps.run', status: 'held', title: 'Restart the demo web app',
        summary: 'docker restart demo-web', createdAt: iso(1), expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
        url: `${hub}/auth/admin/approvals/${mk(1)}`, jobId: 'job-demo-1',
        veto: { runsAt: new Date(now.getTime() + runsIn * 1000).toISOString(), secondsLeft: runsIn, countdownSeconds: 90, state: 'held', actions: ['deny', 'approve-now', 'shelve'] },
        source: { kind: 'claude_code', who: 'landing-page build', client: 'claude-code' },
      },
      {
        id: mk(2), tool: 'github.pulls/create', title: 'Open a pull request: landing page copy',
        summary: 'Opens PR "Landing page copy" on the demo repo.', createdAt: iso(4), expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
        url: `${hub}/auth/admin/approvals/${mk(2)}`, source: { kind: 'agent', who: 'Molly' },
      },
      {
        id: mk(3), tool: 'hub.memory_write', title: 'Save the weekly plan',
        summary: 'Writes plan/week.json in the demo project.', createdAt: iso(9), expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
        url: `${hub}/auth/admin/approvals/${mk(3)}`, source: { kind: 'claude_ai', who: 'Planning chat' },
      },
    ],
  };
}

export function buildSeed() {
  const s = notes();
  const p = (folder: string, t: string) => `${HUB_PROJECT}/${folder}/${t}/head.json`;
  return {
    $axf: 'walkthrough-seed@1',
    user: DEMO_USER,
    files: {
      [p(DATA_FOLDER, LISTS_TABLE)]: table(LISTS_TABLE, s.lists),
      [p(DATA_FOLDER, ITEMS_TABLE)]: table(ITEMS_TABLE, s.items),
      [p(VOICE_NOTES_FOLDER, 'lists')]: table('lists', {}),
      [p(VOICE_NOTES_FOLDER, 'notes')]: table('notes', {}),
    } as Record<string, unknown>,
    approvals: approvals(),
  };
}

if (process.argv[1]?.endsWith('seed.mts')) {
  const out = JSON.stringify(buildSeed(), null, 1);
  if (process.argv[2]) writeFileSync(process.argv[2], out); else process.stdout.write(out);
}
