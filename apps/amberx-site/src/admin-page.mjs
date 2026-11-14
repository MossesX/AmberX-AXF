/**
 * Admin view (/admin): waitlist in line order, invite / remove, CSV export, and every site setting.
 * The page itself is public markup; all data comes from /api/admin/* with the admin token (kept in sessionStorage).
 */
export function renderAdmin() {
  return `<!doctype html>
<html lang="en" data-fx-btn="solid" data-fx-card="default">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>AmberX waitlist admin</title>
<link rel="stylesheet" href="/axf.css">
<link rel="stylesheet" href="/theme.css">
<link rel="stylesheet" href="/site.css">
<script src="/admin.js" defer></script>
</head>
<body class="site site-admin">
<header class="site-head"><a class="site-brand" href="/">AmberX</a><span class="site-muted">Waitlist admin</span></header>
<main class="site-admin__main">
  <form class="fx-card site-admin__card site-form" data-admin-form="login">
    <label class="fx-field site-grow"><span class="fx-field__label">Admin token</span>
      <input class="fx-input" type="password" name="token" autocomplete="current-password" required></label>
    <button class="fx-btn fx-btn--primary" type="submit">Open</button>
  </form>
  <p class="fx-field__error" data-admin-error role="alert" hidden></p>

  <section class="site-admin__body" data-admin-body hidden>
    <div class="site-row" data-admin-stats aria-live="polite"></div>
    <div class="fx-card site-admin__card">
      <div class="site-row site-admin__bar" role="toolbar" aria-label="Waitlist actions">
        <input class="fx-input site-grow" type="search" placeholder="Search email or code" data-admin-q aria-label="Search">
        <button class="fx-btn fx-btn--neutral" type="button" data-admin-action="refresh">Refresh</button>
        <button class="fx-btn fx-btn--primary" type="button" data-admin-action="export">Export CSV</button>
      </div>
      <div class="fx-tablewrap"><table class="fx-table">
        <thead><tr><th>#</th><th>Email</th><th>Referrals</th><th>Joined</th><th>Status</th><th>Code</th><th><span class="site-sr">Actions</span></th></tr></thead>
        <tbody data-admin-rows></tbody>
      </table></div>
    </div>

    <form class="fx-card site-admin__card site-admin__settings" data-admin-form="settings">
      <h2>Site settings</h2>
      <div class="site-admin__fields">
        <label class="fx-field"><span class="fx-field__label">Colour theme</span><select class="fx-input" name="colorTheme"></select></label>
        <label class="fx-field"><span class="fx-field__label">Style theme</span><select class="fx-input" name="styleTheme"></select></label>
        <label class="fx-field"><span class="fx-field__label">Buttons</span><select class="fx-input" name="button">
          <option>solid</option><option>soft</option><option>outline</option><option>gradient</option></select></label>
        <label class="fx-field"><span class="fx-field__label">Cards</span><select class="fx-input" name="card">
          <option>default</option><option>panel</option><option>outline</option><option>glass</option></select></label>
        <label class="fx-field"><span class="fx-field__label">Eyebrow</span><input class="fx-input" name="eyebrow"></label>
        <label class="fx-field"><span class="fx-field__label">Hook</span><input class="fx-input" name="hook"></label>
        <label class="fx-field site-admin__wide"><span class="fx-field__label">Sub-line</span><textarea class="fx-input" name="sub" rows="2"></textarea></label>
        <label class="fx-field"><span class="fx-field__label">Demo video URL (YouTube, Vimeo or .mp4)</span><input class="fx-input" name="videoUrl"></label>
        <label class="fx-field"><span class="fx-field__label">Video caption</span><input class="fx-input" name="videoCaption"></label>
        <label class="fx-field"><span class="fx-field__label">Price per month</span><input class="fx-input" type="number" min="0" name="pricing.price"></label>
        <label class="fx-field"><span class="fx-field__label">Free trial days</span><input class="fx-input" type="number" min="0" name="pricing.trialDays"></label>
        <label class="fx-field"><span class="fx-field__label">Stripe price id</span><input class="fx-input" name="pricing.stripePriceId"></label>
        <label class="fx-field"><span class="fx-field__label">Checkout URL (empty = waitlist)</span><input class="fx-input" name="pricing.checkoutUrl"></label>
        <label class="fx-field"><span class="fx-field__label">Places per referral</span><input class="fx-input" type="number" min="0" name="referralBoost"></label>
        <label class="fx-field"><span class="fx-field__label">Waitlist</span><select class="fx-input" name="waitlistOpen">
          <option value="true">Open</option><option value="false">Closed</option></select></label>
      </div>
      <div class="site-row" role="toolbar" aria-label="Settings actions">
        <button class="fx-btn fx-btn--primary" type="submit">Save</button>
        <a class="fx-btn fx-btn--neutral" href="/" target="_blank" rel="noopener">View site</a>
      </div>
      <p class="site-muted" data-admin-saved aria-live="polite"></p>
    </form>
  </section>
</main>
</body>
</html>`;
}
