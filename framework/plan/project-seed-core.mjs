/**
 * project-seed-core — the demo data a new project can start with (projects@1, `seed: 'demo'`). Pure: no IO, no clock
 * (the caller passes `today`), so the same project on the same day always gets the same set.
 *
 * Every record is clearly marked as test data: titles start with DEMO_PREFIX, every to-do, note, plan and build
 * carries DEMO_TAG, and notes and plans say so in their first line. framework/cli/project-seed.mjs writes the set into
 * the project's own stores (to-dos and lists: todo-manager; notes: the hub's project notes; plans: Plan Studio;
 * builds: the builds store under the project's build profile).
 *
 *   project-seed@1 = {
 *     $axf, kind: 'demo', project, today,
 *     lists:  [{ key, title, parent: key|null, tone, icon }]                    (a tree, 4 levels deep)
 *     todos:  [{ key, list: key, kind: 'todo', title, body, status, priority, due: 'YYYY-MM-DD'|null, tags, checklist }]
 *     notes:  [{ path: '<folder>/<name>.md', title, content }]
 *     plans:  [{ id, title, status, priority, category, tags, summary, body, steps: [{ text, model, estimate, done? }] }]
 *     builds: [{ id, title, detail, category, status, note, steps: [{ text, model, estimate, done }] }]
 *   }
 */
export const SEED_SCHEMA = 'project-seed@1';
export const DEMO_PREFIX = '[Demo] ';
export const DEMO_TAG = 'demo-data';
export const DEMO_NOTES_FOLDER = 'Demo data';
/** todo-manager's statuses; "doing" is its in_progress. */
export const TODO_STATUS = Object.freeze({ open: 'open', doing: 'in_progress', done: 'done' });

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `today` ± n days as YYYY-MM-DD (UTC calendar arithmetic). */
export function shiftDay(today, n) {
  if (!DATE.test(String(today))) throw new Error(`today must be YYYY-MM-DD (got ${today})`);
  return new Date(Date.parse(`${today}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

const demo = (title) => `${DEMO_PREFIX}${title}`;

/** The demo data set for `project` ({ id, name }) on `today` (YYYY-MM-DD). */
export function demoSeed(project, { today }) {
  const id = String(project?.id ?? '');
  const name = String(project?.name ?? id);
  if (!id) throw new Error('demoSeed needs a project id');
  const day = (n) => shiftDay(today, n);

  // Lists: two roots, four levels on the deepest branch (Product › Website › Landing page › Copy review).
  const lists = [
    { key: 'product', title: demo('Product'), parent: null, tone: 'accent', icon: 'layers' },
    { key: 'website', title: 'Website', parent: 'product', tone: 'info', icon: 'globe' },
    { key: 'landing', title: 'Landing page', parent: 'website', tone: '', icon: '' },
    { key: 'copy', title: 'Copy review', parent: 'landing', tone: 'warning', icon: '' },
    { key: 'blog', title: 'Blog', parent: 'website', tone: '', icon: '' },
    { key: 'mobile', title: 'Mobile app', parent: 'product', tone: 'info', icon: 'smartphone' },
    { key: 'onboarding', title: 'Onboarding', parent: 'mobile', tone: '', icon: '' },
    { key: 'personal', title: demo('Personal'), parent: null, tone: 'success', icon: 'user' },
    { key: 'errands', title: 'Errands', parent: 'personal', tone: '', icon: '' },
    { key: 'groceries', title: 'Groceries', parent: 'errands', tone: '', icon: '' },
  ];

  const t = (key, list, title, status, due, tags, checklist, priority = 'normal', body = '') => ({
    key, list, kind: 'todo', title: demo(title), body, status: TODO_STATUS[status], priority, due,
    tags: [DEMO_TAG, ...tags], checklist: checklist.map((text, i) => ({ id: `c${i}`, text, done: status === 'done' || (status === 'doing' && i === 0) })),
  });
  const todos = [
    t('hero', 'landing', 'Write the hero headline', 'doing', day(0), ['copy', 'web'], ['Three options', 'Pick one with the team'], 'high'),
    t('proof', 'copy', 'Proofread the pricing section', 'open', day(-2), ['copy'], ['Prices match the plan', 'No broken links'], 'urgent', 'Overdue on purpose: shows how late items look.'),
    t('og', 'landing', 'Add social preview images', 'open', day(3), ['web', 'design'], ['1200×630 image', 'Alt text']),
    t('post', 'blog', 'Draft the launch post', 'open', day(0), ['writing'], ['Outline', 'First draft', 'Screenshots']),
    t('rss', 'blog', 'Turn on the RSS feed', 'done', day(-5), ['web'], ['Feed URL works']),
    t('welcome', 'onboarding', 'Design the welcome screen', 'doing', day(1), ['design', 'mobile'], ['Sketch', 'Prototype']),
    t('perm', 'onboarding', 'Explain the permissions prompt', 'open', day(-1), ['mobile', 'copy'], ['Plain-language text'], 'high'),
    t('store', 'mobile', 'Store listing screenshots', 'done', day(-3), ['mobile', 'design'], ['Phone', 'Tablet']),
    t('milk', 'groceries', 'Buy oat milk and coffee', 'open', day(0), ['errand'], ['Oat milk', 'Coffee beans'], 'low'),
    t('post-office', 'errands', 'Post the parcel', 'open', null, ['errand'], ['Print the label'], 'low'),
  ];

  const note = (file, title, lines) => ({
    path: `${DEMO_NOTES_FOLDER}/${file}.md`,
    title: demo(title),
    content: `# ${demo(title)}\n\n_Demo data for ${name}: safe to edit or delete._\n\n${lines.join('\n')}\n`,
  });
  const notes = [
    note('welcome', 'Welcome', [`This project (\`${id}\`) was started with demo data so every screen has something to show.`, '', 'Everything marked [Demo] or tagged `demo-data` is test data.']),
    note('meeting-notes', 'Kick-off meeting notes', ['- Goal: launch the website and the app together', '- Owner for copy: the writer', '- Next check-in: Friday']),
    note('ideas', 'Ideas backlog', ['- Dark mode for the landing page', '- A changelog page', '- Referral codes in the app']),
    note('research', 'User research summary', ['Five interviews. People want:', '', '1. Faster sign-up', '2. Offline mode', '3. Clear pricing']),
    note('style-guide', 'Writing style guide', ['- Short sentences', '- Plain words', '- Say what happens next']),
  ];

  const plans = [
    {
      id: `demo-${id}-launch`.slice(0, 80), title: demo('Website launch plan'), status: 'ready', priority: 'P1', category: 'Demo', tags: [DEMO_TAG, 'web'],
      summary: 'Demo plan: ship the landing page, blog and social previews.',
      body: `Demo data for ${name}.\n\n## Goal\nLaunch the website with the first blog post.\n`,
      steps: [
        { text: 'Finish the landing page copy', model: 'Opus', estimate: '30 min', done: true },
        { text: 'Publish the launch post', model: 'Opus', estimate: '20 min' },
        { text: 'Check social previews on every network', model: 'Opus', estimate: '15 min' },
      ],
    },
    {
      id: `demo-${id}-onboarding`.slice(0, 80), title: demo('App onboarding plan'), status: 'draft', priority: 'P2', category: 'Demo', tags: [DEMO_TAG, 'mobile'],
      summary: 'Demo plan: a three-screen onboarding with a clear permissions prompt.',
      body: `Demo data for ${name}.\n\n## Screens\n1. Welcome\n2. Permissions\n3. First task\n`,
      steps: [
        { text: 'Prototype the three screens', model: 'Opus', estimate: '30 min' },
        { text: 'Write the permissions explanation', model: 'Opus', estimate: '10 min' },
      ],
    },
  ];

  const build = (key, title, status, steps, note) => ({
    id: `demo-${id}-${key}`.slice(0, 80), title: demo(title), category: 'Demo', status, note,
    detail: `Sample build record for ${name} (demo data, tag ${DEMO_TAG}). It is never queued or dispatched.`,
    steps: steps.map(([text, estimate, done]) => ({ text, model: 'Opus', estimate, done })),
  });
  const builds = [
    build('landing-page', 'Landing page', 'complete', [['Hero section', '20 min', true], ['Pricing section', '20 min', true]], 'Demo data: a finished build.'),
    build('onboarding', 'Onboarding screens', 'blocked', [['Welcome screen', '20 min', true], ['Permissions screen', '20 min', false]], 'Demo data: blocked on purpose so it is never dispatched.'),
  ];

  return { $axf: SEED_SCHEMA, kind: 'demo', project: id, today, lists, todos, notes, plans, builds };
}

/** How deep a list tree goes (1 = roots only). */
export function listDepth(lists) {
  const by = new Map(lists.map((l) => [l.key, l]));
  const depth = (l, seen = new Set()) => (l.parent && by.has(l.parent) && !seen.has(l.key) ? 1 + depth(by.get(l.parent), seen.add(l.key)) : 1);
  return Math.max(0, ...lists.map((l) => depth(l)));
}
