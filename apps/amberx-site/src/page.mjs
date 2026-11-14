/**
 * The landing page, rendered on the server from the site settings (so search engines and link previews see the
 * real copy). Markup only: every look comes from the framework controls (fx-btn, fx-input, fx-field, fx-card,
 * fx-chip, fx-eyebrow) and site.css, which reads only --fx-* tokens.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CURRENCY = { USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$' };
export const priceLabel = (p) => `${CURRENCY[p.currency] ?? `${p.currency} `}${p.price}`;

/** A YouTube / Vimeo link becomes an embed; any other URL plays in a <video>; empty shows the "coming soon" slot. */
export function videoEmbed(url) {
  if (!url) return null;
  let m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (m) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0` };
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return { kind: 'iframe', src: `https://player.vimeo.com/video/${m[1]}` };
  return { kind: 'video', src: url };
}

function demo(s) {
  const v = videoEmbed(s.videoUrl);
  const inner = !v
    ? `<div class="site-demo__empty"><span class="fx-chip fx-chip--accent">Demo video</span><p>The 60-second demo lands here soon.</p></div>`
    : v.kind === 'iframe'
      ? `<iframe src="${esc(v.src)}" title="AmberX demo" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
      : `<video src="${esc(v.src)}" ${s.videoPoster ? `poster="${esc(s.videoPoster)}"` : ''} controls playsinline preload="metadata"></video>`;
  return `<section class="site-section" id="demo" aria-labelledby="demo-title">
    <p class="fx-eyebrow">See it</p>
    <h2 id="demo-title">From a sentence to a running app</h2>
    <div class="site-demo fx-card" data-site-video="${v ? v.kind : 'empty'}">${inner}</div>
    ${s.videoCaption ? `<p class="site-muted site-center">${esc(s.videoCaption)}</p>` : ''}
  </section>`;
}

function features(s) {
  const cards = (s.features ?? []).map((f, i) => `<article class="fx-card site-feature">
      <span class="site-feature__n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
      <h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></article>`).join('\n');
  return `<section class="site-section" id="features" aria-labelledby="features-title">
    <p class="fx-eyebrow">Why AmberX</p>
    <h2 id="features-title">Building an app, without building it yourself</h2>
    <div class="site-grid">${cards}</div>
  </section>`;
}

function pricing(s) {
  const p = s.pricing;
  const live = Boolean(p.checkoutUrl);
  const cta = live
    ? `<a class="fx-btn fx-btn--primary site-wide" href="${esc(p.checkoutUrl)}" data-site-action="checkout">Start your ${esc(p.trialDays)}-day free trial</a>`
    : `<a class="fx-btn fx-btn--primary site-wide" href="#waitlist" data-site-action="join">Join the waitlist</a>`;
  return `<section class="site-section" id="pricing" aria-labelledby="pricing-title">
    <p class="fx-eyebrow">Pricing</p>
    <h2 id="pricing-title">One plan. Try it free.</h2>
    <article class="fx-card site-plan" data-stripe-price="${esc(p.stripePriceId)}">
      <h3>${esc(p.plan)}</h3>
      <p class="site-plan__price"><strong>${esc(priceLabel(p))}</strong><span class="site-muted"> / ${esc(p.interval)}</span></p>
      <p class="site-muted">${esc(p.trialDays)} days free, then ${esc(priceLabel(p))} a ${esc(p.interval)}. No card needed to join the waitlist.</p>
      <ul class="site-list">${p.includes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${cta}
    </article>
  </section>`;
}

function waitlist(s, ref) {
  if (!s.waitlistOpen) {
    return `<section class="site-section" id="waitlist" aria-labelledby="waitlist-title">
      <h2 id="waitlist-title">The waitlist is closed</h2><p class="site-muted site-center">Early access is full for now. Check back soon.</p></section>`;
  }
  return `<section class="site-section" id="waitlist" aria-labelledby="waitlist-title">
    <p class="fx-eyebrow">Early access</p>
    <h2 id="waitlist-title">Get in line. Bring friends, move up.</h2>
    <p class="site-muted site-center">Every friend who joins with your link moves you up the line. The front of the line gets in first.</p>
    <div class="fx-card site-join">
      <form class="site-form" data-site-form="waitlist" novalidate>
        <label class="fx-field site-grow"><span class="fx-field__label">Email</span>
          <input class="fx-input" type="email" name="email" autocomplete="email" required placeholder="you@example.com"></label>
        <input type="hidden" name="ref" value="${esc(ref)}">
        <button class="fx-btn fx-btn--primary" type="submit">Join the waitlist</button>
      </form>
      ${ref ? `<p class="site-muted" data-site-ref>Invited by a friend: you both move up when you join.</p>` : ''}
      <p class="fx-field__error" data-site-error role="alert" hidden></p>
      <div class="site-status" data-site-status hidden aria-live="polite">
        <p class="site-status__rank">You are <strong data-site-position>#–</strong> of <span data-site-total>–</span></p>
        <p class="site-muted"><span data-site-referrals>0</span> friends joined with your link.</p>
        <label class="fx-field"><span class="fx-field__label">Your referral link</span>
          <input class="fx-input" type="text" readonly data-site-link></label>
        <div class="site-row"><button class="fx-btn fx-btn--neutral" type="button" data-site-action="copy">Copy link</button>
          <button class="fx-btn fx-btn--neutral" type="button" data-site-action="share">Share</button></div>
      </div>
    </div>
  </section>`;
}

/** The whole page. `opts.ref` = the referral code from ?ref=, `opts.themeQuery` keeps a preview theme on reload. */
export function renderPage(s, opts = {}) {
  const ref = typeof opts.ref === 'string' ? opts.ref.slice(0, 32) : '';
  const tq = opts.themeQuery ? `?${opts.themeQuery}` : '';
  const title = `${s.brand}: ${s.hook}`;
  return `<!doctype html>
<html lang="en" data-fx-btn="${esc(s.button)}" data-fx-card="${esc(s.card)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(s.sub)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(s.sub)}">
<meta property="og:type" content="website">
<link rel="stylesheet" href="/axf.css">
<link rel="stylesheet" href="/theme.css${esc(tq)}">
<link rel="stylesheet" href="/site.css">
<script src="/site.js" defer></script>
</head>
<body class="site">
<header class="site-head">
  <a class="site-brand" href="/">${esc(s.brand)}</a>
  <nav class="site-nav" aria-label="Sections"><a href="#demo">Demo</a><a href="#features">Features</a><a href="#pricing">Pricing</a></nav>
  <a class="fx-btn fx-btn--primary fx-btn--sm" href="#waitlist">Join the waitlist</a>
</header>
<main>
  <section class="site-hero" aria-labelledby="hook">
    ${s.eyebrow ? `<p class="fx-eyebrow">${esc(s.eyebrow)}</p>` : ''}
    <h1 id="hook">${esc(s.hook)}</h1>
    <p class="site-hero__sub">${esc(s.sub)}</p>
    <div class="site-row site-row--center">
      <a class="fx-btn fx-btn--primary" href="#waitlist">Join the waitlist</a>
      <a class="fx-btn fx-btn--neutral" href="#demo">Watch the demo</a>
    </div>
    <p class="site-muted">${esc(s.pricing.trialDays)}-day free trial, then ${esc(priceLabel(s.pricing))}/${esc(s.pricing.interval)}.</p>
  </section>
  ${demo(s)}
  ${features(s)}
  ${pricing(s)}
  ${waitlist(s, ref)}
</main>
<footer class="site-foot"><span>© ${new Date().getFullYear()} ${esc(s.brand)}</span><a href="#pricing">Pricing</a><a href="#waitlist">Waitlist</a></footer>
</body>
</html>`;
}
