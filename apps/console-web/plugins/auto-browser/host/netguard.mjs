/**
 * What the VPS browser may open. Only http(s) and about:blank; private and internal hosts (localhost, RFC 1918,
 * link-local, single-label Docker names like `axf-console`) are refused unless the host runs with
 * AXF_BROWSER_ALLOW_PRIVATE=1, so a routine or an assistant can't use the browser to reach services behind the proxy.
 * Checks the hostname only (no DNS lookup); public names that resolve to private addresses are out of scope here.
 */
import { isIP } from 'node:net';

export function allowPrivate() { return /^(1|true|on|yes)$/i.test(process.env.AXF_BROWSER_ALLOW_PRIVATE || ''); }

/** Normalise what a user typed in the URL bar: "example.com" → "https://example.com/". */
export function normaliseUrl(input) {
  const s = String(input ?? '').trim();
  if (!s || s === 'about:blank') return 'about:blank';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:/]+:\d+(\/|$)/.test(s)) return new URL(s).href;
  if (/\s/.test(s) || !/[.:]/.test(s)) return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
  return new URL(`https://${s}`).href;
}

function privateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function privateV6(ip) {
  const s = ip.toLowerCase();
  if (s === '::1' || s === '::') return true;
  if (s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80')) return true;
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return m ? privateV4(m[1]) : false;
}

/** Why a URL is refused, or '' when it may be opened. */
export function blockedReason(url) {
  let u;
  try { u = new URL(url); } catch { return 'not a valid address'; }
  if (u.href === 'about:blank') return '';
  if (u.protocol === 'data:' || u.protocol === 'blob:') return ''; // sub-resources pages build themselves
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return `${u.protocol} addresses are not allowed`;
  if (allowPrivate()) return '';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const kind = isIP(host);
  if (kind === 4 && privateV4(host)) return 'private network addresses are blocked';
  if (kind === 6 && privateV6(host)) return 'private network addresses are blocked';
  if (!kind) {
    const h = host.toLowerCase();
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return 'internal hosts are blocked';
    if (!h.includes('.')) return 'internal hosts are blocked';
  }
  return '';
}
