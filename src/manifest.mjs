// Loads the repo manifest: the public repos.json plus, when present, the private overlay that sits next to this repo.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { expand } from './lib.mjs';

const here = new URL('..', import.meta.url);

export const devRoot = () => resolve(process.env.WORKSPACE_DEV_ROOT ?? join(homedir(), 'dev'));

export function loadRepos({ root = here } = {}) {
  const read = (u) => JSON.parse(readFileSync(u, 'utf8')).repos;
  const overlay = new URL('../workspace-private/repos.private.json', root);
  const all = [...read(new URL('repos.json', root)), ...(existsSync(overlay) ? read(overlay) : [])];
  return all.map((r) => {
    const p = expand(r.path);
    return { ...r, abs: resolve(isAbsolute(p) ? p : join(devRoot(), p)) };
  });
}

export function loadScopes({ root = here } = {}) {
  return JSON.parse(readFileSync(new URL('scopes.json', root), 'utf8')).scopes;
}

/** Repos belonging to a scope; `all` is every repo. Throws on an unknown scope so a typo never silently selects nothing. */
export function reposInScope(repos, scope, scopes = loadScopes()) {
  if (scope === 'all') return repos;
  if (!scopes[scope]) throw new Error(`unknown scope "${scope}" (known: ${Object.keys(scopes).join(', ')}, all)`);
  return repos.filter((r) => r.scopes?.includes(scope));
}
