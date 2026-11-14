/**
 * File drop zone (themed-controls@1 family `file`): click (or Enter / Space) to browse, drag and drop, a file list with
 * a remove button and a progress bar per file, `accept` and `multiple` respected, an aria-live status line.
 * The files go into the original input (DataTransfer) and fire input + change, so forms and upload code see a normal
 * pick. Upload progress is the page's to report: dispatch `axf:file-progress` on the input with
 * `{ name, loaded, total, failed? }` (or `{ name, done: true }`) and the file's bar follows.
 * File inputs the page hides itself (a custom "Upload" button that clicks a hidden input) are left alone.
 */
import type { ElementFamily, Swap, SwapCtx } from '../host';
import { aria, h } from './dom';
import { icon, iconButton } from './surface';

export interface FileProgress { loaded: number; total: number; failed?: boolean; done?: boolean }

const units = ['B', 'KB', 'MB', 'GB'];
export function size(n: number): string {
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i ? v.toFixed(v < 10 ? 1 : 0) : v} ${units[i]}`;
}

/** Does a file match an accept list (".png", "image/*", "text/plain")? */
export function accepts(file: { name: string; type: string }, accept: string[]): boolean {
  if (!accept.length) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  return accept.some((a) => {
    const x = a.trim().toLowerCase();
    if (!x) return false;
    if (x.startsWith('.')) return name.endsWith(x);
    if (x.endsWith('/*')) return type.startsWith(x.slice(0, -1));
    return type === x;
  });
}

export const fileFamily: ElementFamily = {
  family: 'file',
  selector: 'input[type="file"]',
  skip: (i) => { const cs = getComputedStyle(i); return cs.display === 'none' || cs.visibility === 'hidden' || i.classList.contains('fx-sr-only'); },
  mount(ctx: SwapCtx): Swap {
    let p = ctx.props();
    const progress = new Map<string, FileProgress>();
    const title = h('span', { class: 'fx-tc-file__title' });
    const hint = h('span', { class: 'fx-tc-file__hint' });
    const zone = h('div', { class: 'fx-tc-file__zone', role: 'button', tabindex: '0' }, icon('upload'), title, hint);
    const list = h('ul', { class: 'fx-tc-file__list', 'aria-label': 'Chosen files' });
    const status = h('p', { class: 'fx-tc-file__status', 'aria-live': 'polite' });
    const el = h('div', { class: 'fx-tc-file' }, zone, list, status);
    const say = (t: string) => { status.textContent = t; };

    const files = (): File[] => Array.from(ctx.input.files ?? []);
    const accept = (): string[] => (Array.isArray(p.accept) ? (p.accept as string[]) : []);
    const put = (next: File[]) => {
      const dt = new DataTransfer();
      for (const f of next) dt.items.add(f);
      ctx.input.files = dt.files;
      ctx.input.dispatchEvent(new Event('input', { bubbles: true }));
      ctx.input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const take = (incoming: File[]) => {
      const ok = incoming.filter((f) => accepts(f, accept()));
      const refused = incoming.length - ok.length;
      if (!ok.length) { say(refused ? `${refused === 1 ? 'That file is' : 'Those files are'} not accepted here (${accept().join(', ')}).` : 'No files.'); return; }
      const next = p.multiple ? [...files(), ...ok.filter((f) => !files().some((x) => x.name === f.name && x.size === f.size))] : [ok[0]!];
      put(next);
      say(`${next.length} file${next.length === 1 ? '' : 's'} chosen${refused ? `; ${refused} not accepted` : ''}${!p.multiple && ok.length > 1 ? '; only one is allowed' : ''}.`);
    };

    const browse = () => { if (!ctx.input.disabled) ctx.input.click(); };
    zone.addEventListener('click', browse);
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); browse(); } });
    let depth = 0;
    zone.addEventListener('dragenter', (e) => { if (ctx.input.disabled) return; e.preventDefault(); depth++; zone.dataset.dragover = 'true'; });
    zone.addEventListener('dragover', (e) => { if (ctx.input.disabled) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
    zone.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; delete zone.dataset.dragover; } });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      delete zone.dataset.dragover;
      if (ctx.input.disabled) return;
      take(Array.from(e.dataTransfer?.files ?? []));
    });
    const onProgress = (e: Event) => {
      const d = (e as CustomEvent<{ name: string } & Partial<FileProgress>>).detail;
      if (!d?.name) return;
      const cur = progress.get(d.name) ?? { loaded: 0, total: 0 };
      const next = { loaded: d.loaded ?? (d.done ? cur.total || 1 : cur.loaded), total: d.total ?? (cur.total || 1), failed: d.failed ?? cur.failed, done: d.done ?? cur.done };
      progress.set(d.name, next);
      draw();
      if (next.failed) say(`${d.name} failed to upload.`);
      else if (next.done || (next.total && next.loaded >= next.total)) say(`${d.name} uploaded.`);
    };
    ctx.input.addEventListener('axf:file-progress', onProgress);

    function draw(): void {
      const fs = files();
      list.replaceChildren(...fs.map((f, i) => {
        const pr = progress.get(f.name);
        const pct = pr && pr.total ? Math.min(100, Math.round((pr.loaded / pr.total) * 100)) : null;
        const rm = iconButton(`Remove ${f.name}`, 'x', 'fx-tc-file__remove');
        rm.disabled = !!p.disabled;
        rm.addEventListener('click', () => { const next = files().filter((_, j) => j !== i); progress.delete(f.name); put(next); say(`${f.name} removed.`); zone.focus(); });
        const bar = pct === null ? null : h('span', { class: 'fx-tc-file__bar', role: 'progressbar', 'aria-label': `${f.name} upload`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'data-state': pr?.failed ? 'failed' : pct >= 100 || pr?.done ? 'done' : 'busy' }, h('span', { class: 'fx-tc-file__fill' }));
        bar?.style.setProperty('--tc-pct', `${pct}%`);
        return h('li', { class: 'fx-tc-file__item' }, icon('file'), h('span', { class: 'fx-tc-file__name' }, f.name), h('span', { class: 'fx-tc-file__size' }, size(f.size)), bar, rm);
      }));
      list.hidden = !fs.length;
    }

    return {
      el,
      focusEl: () => zone,
      sync(next) {
        p = next;
        const acc = accept();
        title.textContent = p.multiple ? 'Drop files here or browse' : 'Drop a file here or browse';
        hint.textContent = acc.length ? `Accepts ${acc.join(', ')}` : '';
        const label = (p.label && !String(p.label).startsWith('#') ? String(p.label) : ctx.labelText()) || 'Files';
        aria(zone, { 'aria-label': `${label}: ${title.textContent}${hint.textContent ? `. ${hint.textContent}` : ''}`, 'aria-disabled': p.disabled ? 'true' : null, 'aria-describedby': p.describedBy ? String(p.describedBy) : null, 'aria-invalid': p.invalid ? 'true' : null });
        zone.tabIndex = p.disabled ? -1 : 0;
        el.toggleAttribute('data-disabled', !!p.disabled);
        el.toggleAttribute('data-invalid', !!p.invalid);
        draw();
      },
      destroy() { ctx.input.removeEventListener('axf:file-progress', onProgress); },
      state: () => ({ files: files().map((f) => ({ name: f.name, size: f.size, type: f.type, progress: progress.get(f.name) ?? null })), accept: accept(), multiple: !!p.multiple }),
      set(v) {
        // the API can only clear (a browser never lets a script pick files from disk)
        const s = String(v ?? '').trim().toLowerCase();
        if (s === '' || s === 'clear' || s === 'none') { progress.clear(); put([]); say('Files cleared.'); return; }
        const keep = files().filter((f) => f.name.toLowerCase() !== s);
        if (keep.length === files().length) throw new Error('a file control can only be cleared (value "clear") or have one file removed by name');
        progress.delete(String(v));
        put(keep);
      },
    };
  },
};
