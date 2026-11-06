/**
 * memory-chain — the memory files Claude Code loads at session start, in its order (context-chain@1 and chain-control@1
 * both read this). File access is injected; the defaults read the disk.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const MAX_FILE_BYTES = 512 * 1024;
const MAX_ITEMS = 600;
const IMPORT_DEPTH = 5;          // Claude Code follows @imports five levels deep

/** @imports of a memory file (outside code spans and blocks), resolved against the file's folder; `~/` = home. Pure. */
export function importsOf(text, file, home = homedir()) {
  const out = [];
  let fence = false;
  for (const line of String(text ?? '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const bare = line.replace(/`[^`]*`/g, '');
    for (const m of bare.matchAll(/(?:^|\s)@((?:~\/|\.{0,2}\/)?[A-Za-z0-9_.~\/-]+\.[A-Za-z0-9]+)/g)) {
      const p = m[1];
      out.push(p.startsWith('~/') ? join(home, p.slice(2)) : isAbsolute(p) ? p : resolve(dirname(file), p));
    }
  }
  return out;
}

export const readText = (p) => { try { const st = statSync(p); if (!st.isFile() || st.size > MAX_FILE_BYTES) return null; return readFileSync(p, 'utf8'); } catch { return null; } };
export function listDir(d) { try { return readdirSync(d); } catch { return []; } }

/**
 * The memory files Claude Code loads at start, in its order: the user's ~/.claude/CLAUDE.md, then each folder from the
 * outermost down to `cwd` (CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md), then .claude/rules/*.md; each file followed
 * by its @imports (depth-first). `fsRead` is injectable for tests. Returns [{path, via, depth, parent, reason}].
 */
export function memoryChain(cwd, { home = homedir(), read = readText, list = listDir } = {}) {
  const out = []; const seen = new Set();
  const visit = (path, via, depth, parent) => {
    if (seen.has(path) || out.length >= MAX_ITEMS) return;
    const text = read(path); if (text == null) return;
    seen.add(path); out.push({ path, via, depth, parent, reason: parent ? 'import' : 'session-start' });
    if (depth >= IMPORT_DEPTH) return;
    for (const imp of importsOf(text, path, home)) visit(imp, 'import', depth + 1, path);
  };
  visit(join(home, '.claude', 'CLAUDE.md'), 'user memory', 0, '');
  const dirs = []; for (let d = resolve(cwd); ; d = dirname(d)) { dirs.unshift(d); if (dirname(d) === d) break; }
  for (const d of dirs) {
    if (d === '/' ) continue;
    for (const f of ['CLAUDE.md', join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md']) visit(join(d, f), 'project memory', 0, '');
  }
  for (const d of dirs) for (const f of list(join(d, '.claude', 'rules')).filter((x) => x.endsWith('.md')).sort()) visit(join(d, '.claude', 'rules', f), 'project rules', 0, '');
  return out;
}

