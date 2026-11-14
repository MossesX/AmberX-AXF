# AmberX site

The public AmberX launch page (amberxai.com): one hook, a 60-second demo video slot, feature highlights, a
Stripe-ready pricing section (free trial, then $30/month) and a waitlist where every referral moves you up the line.
Zero dependencies: plain Node ≥ 20.

```bash
node apps/amberx-site/bake.mjs                      # compile the framework look (needs the repo's framework/)
SITE_ADMIN_TOKEN=… node apps/amberx-site/server.mjs # http://localhost:8080, admin at /admin
node --test apps/amberx-site/test/
```

| Env | Default | |
| --- | --- | --- |
| `PORT` | `8080` | |
| `DATA_DIR` | `apps/amberx-site/data` | `settings.json` + `waitlist.json` (mount a volume here) |
| `SITE_ADMIN_TOKEN` | — | admin API and `/admin`; unset = admin API off |
| `PUBLIC_URL` | request host | base of referral links, e.g. `https://amberxai.com` |
| `BAKED_DIR` | `apps/amberx-site/baked` | output of `bake.mjs` |

## Look

Nothing is styled by hand. `bake.mjs` compiles every framework `color-theme` and `style-theme` asset plus the
`reader` / `roomy` / `touch` scale assets into `--fx-*` tokens; `/theme.css` serves the chosen pair and the page uses
the framework's own controls (`fx-btn`, `fx-input`, `fx-field`, `fx-card`, `fx-chip`) from `axf.css`. Switch theme
with the `colorTheme` / `styleTheme` / `button` / `card` settings, or preview without saving: `/?color=fresh-light&style=swiss`.

## Ranking

`score = join order − referrals × referralBoost` (default 5 places per referral); lower goes first, ties go to more
referrals, then the earlier sign-up. Only `waiting` entries hold a place; `invited` ones have been let in.

## API

Public: `GET /api/site` · `POST /api/waitlist {email, ref?}` → `{code, position, total, referrals, link}` ·
`GET /api/waitlist/<code>`.

Admin (`Authorization: Bearer $SITE_ADMIN_TOKEN`):

| | |
| --- | --- |
| `GET /api/admin/settings` · `PUT /api/admin/settings` (partial) · `POST /api/admin/settings/reset` | landing page settings |
| `GET /api/admin/waitlist?q=&limit=` · `GET /api/admin/waitlist/stats` | the line, in order; stats |
| `GET /api/admin/waitlist.csv` | export |
| `GET` · `PATCH {status}` · `DELETE /api/admin/waitlist/<code>` | one entry; invite / back in line; remove |

Settings: `brand, eyebrow, hook, sub, videoUrl, videoPoster, videoCaption, features[{title,text}], colorTheme,
styleTheme, button (solid|soft|outline|gradient), card (default|panel|outline|glass), pricing{plan, trialDays, price,
currency, interval, includes[], stripePriceId, checkoutUrl}, waitlistOpen, referralBoost`. With `pricing.checkoutUrl`
set, the pricing button starts the trial (Stripe Checkout / Payment Link); empty, it joins the waitlist.

## From the console

The **Launch waitlist** console plugin proxies the admin API (console env `AMBERX_SITE_URL`,
`AMBERX_SITE_ADMIN_TOKEN`) so the same actions reach every surface:

- Console page: Plugins → Launch waitlist (console control address `view:launch-waitlist`, e.g. `console_open view:launch-waitlist`; voice "open launch waitlist").
- REST: `/api/plugins/launch-waitlist/{status,stats,entries,entries/<code>/invite,export,settings,…}` and
  `/api/control/launch-waitlist/<command>` (control@1).
- MCP: `launch-waitlist_<command>` tools (`plugin_commands` lists them), e.g. `launch-waitlist_entries`,
  `launch-waitlist_export`, `launch-waitlist_settings-set`.
- CLI: `axf launch-waitlist <command>` (`axf launch-waitlist` lists them).
- AmberX voice: through the same MCP tools (e.g. "how many are on the waitlist", "change the hook to …").

## Deploy

`Dockerfile` (build context = repository root) bakes the look and runs the server; see `DEPLOY.md`.
