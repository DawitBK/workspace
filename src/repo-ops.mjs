// Git operations on the repos in a manifest. Pull is fast-forward only; push never forces; nothing is deleted.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { repoGate } from './lib.mjs';

const git = (dir, args, opts = {}) => execFileSync('git', dir ? ['-C', dir, ...args] : args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const tryGit = (dir, args) => { try { return git(dir, args); } catch (e) { return null; } };

export function statusOf(repo, { fetch = false } = {}) {
  if (!existsSync(join(repo.abs, '.git'))) return { name: repo.name, state: 'missing' };
  const g = repoGate(repo.abs);
  if (fetch && g.remotes.length) tryGit(repo.abs, ['fetch', '--quiet']);
  const branch = tryGit(repo.abs, ['branch', '--show-current']) ?? '?';
  const counts = tryGit(repo.abs, ['rev-list', '--left-right', '--count', '@{u}...HEAD']);
  const [behind, ahead] = counts ? counts.split('\t').map(Number) : [null, g.unpushed];
  return { name: repo.name, state: g.commits === 0 ? 'no-commits' : !g.remotes.length ? 'no-remote' : 'ok', branch, ahead, behind, dirty: g.dirty };
}

export function pullRepo(repo) {
  if (!existsSync(join(repo.abs, '.git'))) {
    if (!repo.remote) return { name: repo.name, result: 'skipped: not on disk and no remote' };
    mkdirSync(dirname(repo.abs), { recursive: true });
    try { git(null, ['clone', ...(repo.cloneArgs ?? []), repo.remote, repo.abs]); return { name: repo.name, result: 'cloned' }; }
    catch (e) { return { name: repo.name, result: `clone failed: ${String(e.stderr ?? e.message).split('\n')[0]}` }; }
  }
  const g = repoGate(repo.abs);
  if (g.dirty) return { name: repo.name, result: `skipped: ${g.dirty} uncommitted file(s)` };
  if (!g.remotes.length) return { name: repo.name, result: 'skipped: no remote' };
  try { const out = git(repo.abs, ['pull', '--ff-only']); return { name: repo.name, result: /Already up to date/.test(out) ? 'up to date' : 'fast-forwarded' }; }
  catch (e) { return { name: repo.name, result: `not fast-forward or failed: ${String(e.stderr ?? e.message).split('\n')[0]}` }; }
}

export function pushRepo(repo, { execute = false } = {}) {
  const s = statusOf(repo);
  if (s.state === 'missing' || s.state === 'no-remote' || s.state === 'no-commits') return { name: repo.name, result: `skipped: ${s.state}` };
  if (!s.ahead) return { name: repo.name, result: 'nothing to push' };
  if (!execute) return { name: repo.name, result: `would push ${s.ahead} commit(s) on ${s.branch}` };
  try { git(repo.abs, ['push']); return { name: repo.name, result: `pushed ${s.ahead} commit(s)` }; }
  catch (e) { return { name: repo.name, result: `push failed: ${String(e.stderr ?? e.message).split('\n')[0]}` }; }
}

/** Create `.env` from `.env.example` with generated values for anything that looks like a secret placeholder. Never overwrites. */
export function initEnv(repo) {
  const example = join(repo.abs, '.env.example'); const target = join(repo.abs, '.env');
  if (!existsSync(example)) return { name: repo.name, result: 'no .env.example' };
  if (existsSync(target)) return { name: repo.name, result: '.env already exists; left untouched' };
  const text = readFileSync(example, 'utf8').split(/\r?\n/).map((line) => {
    const m = line.match(/^([A-Z0-9_]*(SECRET|PASSWORD|TOKEN|KEY)[A-Z0-9_]*)=(.*)$/);
    return m && /^(|change[-_ ]?me.*|<.*>|your[-_].*|xxx+)$/i.test(m[3].trim()) ? `${m[1]}=${randomBytes(24).toString('hex')}` : line;
  }).join('\n');
  writeFileSync(target, text);
  return { name: repo.name, result: 'created .env with generated secrets' };
}
