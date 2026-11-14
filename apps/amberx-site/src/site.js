/* AmberX public site: waitlist form, place in line, referral link. No styling here: site.css + --fx-* tokens. */
(() => {
  const KEY = 'amberx-waitlist-code';
  const $ = (sel) => document.querySelector(sel);
  const form = $('[data-site-form="waitlist"]');
  const err = $('[data-site-error]');
  const box = $('[data-site-status]');

  const api = async (path, opts = {}) => {
    const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error ?? `request failed (${r.status})`);
    return data;
  };

  function show(s) {
    if (!box) return;
    $('[data-site-position]').textContent = s.position ? `#${s.position}` : 'in';
    $('[data-site-total]').textContent = String(s.total);
    $('[data-site-referrals]').textContent = String(s.referrals);
    $('[data-site-link]').value = s.link;
    box.hidden = false;
    if (form) form.hidden = true;
    const refNote = $('[data-site-ref]');
    if (refNote) refNote.hidden = true;
  }
  const fail = (m) => { if (err) { err.textContent = m; err.hidden = !m; } };

  async function join(email, ref) {
    const s = await api('/api/waitlist', { method: 'POST', body: JSON.stringify({ email, ref }) });
    try { localStorage.setItem(KEY, s.code); } catch { /* private mode */ }
    return s;
  }
  const status = (code) => api(`/api/waitlist/${encodeURIComponent(code)}`);

  form?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    fail('');
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      show(await join(form.email.value, form.ref.value));
    } catch (e) {
      fail(e.message);
    } finally {
      btn.disabled = false;
    }
  });

  document.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-site-action]');
    if (!a) return;
    const link = $('[data-site-link]')?.value;
    if (a.dataset.siteAction === 'copy' && link) {
      try { await navigator.clipboard.writeText(link); a.textContent = 'Copied'; } catch { $('[data-site-link]').select(); }
    }
    if (a.dataset.siteAction === 'share' && link) {
      if (navigator.share) navigator.share({ title: 'AmberX', text: 'Talk, and it builds your app. Join me on the AmberX waitlist:', url: link }).catch(() => {});
      else { try { await navigator.clipboard.writeText(link); a.textContent = 'Link copied'; } catch { /* ignore */ } }
    }
  });

  // Returning visitor: show their place straight away.
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
  if (saved && box) status(saved).then(show).catch(() => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } });

  window.AmberXSite = { join, status };
})();
