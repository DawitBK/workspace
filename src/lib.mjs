// Shared helpers for the workspace tooling. Zero dependencies; nothing here ever opens a file's content except to hash it.
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, extname, basename } from 'node:path';

/** Expand ${HOME} and ${ROOT:<name>} style placeholders so no config hardcodes a user name or a path. */
export function expand(value, vars = {}) {
  const all = { HOME: homedir(), ...vars };
  return String(value).replace(/\$\{([A-Z_]+)\}/g, (_, k) => {
    if (!(k in all)) throw new Error(`unknown placeholder \${${k}}`);
    return all[k];
  });
}

export function sha256(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** True when the directory tree contains no files at all (empty folders only). */
export function isEmptyTree(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() ? !isEmptyTree(join(dir, e.name)) : true) return false;
  }
  return true;
}

/** True when every file in the tree is an Office lock file (`~$name`). */
export function onlyLockFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  if (!entries.length) return false;
  return entries.every((e) => (e.isDirectory() ? onlyLockFiles(join(dir, e.name)) : /^~\$/.test(e.name)));
}

const git = (dir, ...args) => { try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim(); } catch { return null; } };

/** The gate every repo passes before it may be moved or removed. Returns null when `dir` is not a repo. */
export function repoGate(dir) {
  if (!existsSync(join(dir, '.git'))) return null;
  const remotes = (git(dir, 'remote', '-v') ?? '').split('\n').filter((l) => l.endsWith('(push)')).map((l) => l.split('\t')[1]?.split(' ')[0]);
  const commits = Number(git(dir, 'rev-list', '--all', '--count') ?? 0);
  return {
    remotes,
    commits,
    dirty: (git(dir, 'status', '--porcelain') ?? '').split('\n').filter(Boolean).length,
    unpushed: remotes.length ? (git(dir, 'log', '--branches', '--not', '--remotes', '--oneline') ?? '').split('\n').filter(Boolean).length : commits,
    stashes: (git(dir, 'stash', 'list') ?? '').split('\n').filter(Boolean).length,
  };
}

export const gateIsClean = (g) => g && g.remotes.length > 0 && g.commits > 0 && g.dirty === 0 && g.unpushed === 0 && g.stashes === 0;

/** Classify one entry by name and extension only. First matching rule wins. */
export function classify(entry, rules, rootLabel) {
  for (const r of rules) {
    if (r.roots && !r.roots.includes(rootLabel)) continue;
    if (r.type && r.type !== entry.type) continue;
    if (r.ext && !r.ext.includes(extname(entry.name).toLowerCase())) continue;
    if (r.name && !new RegExp(r.name, 'i').test(entry.name)) continue;
    return r;
  }
  return null;
}

export function listDir(dir) {
  return readdirSync(dir, { withFileTypes: true }).map((e) => {
    const path = join(dir, e.name);
    let size = 0, mtime = 0;
    try { const s = statSync(path); size = e.isFile() ? s.size : 0; mtime = s.mtimeMs; } catch { /* unreadable: leave zero */ }
    return { name: e.name, path, type: e.isDirectory() ? 'dir' : 'file', size, mtime };
  });
}

export const driveOf = (p) => (p.match(/^[A-Za-z]:/)?.[0] ?? '/').toUpperCase();
export { basename };
