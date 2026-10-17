#!/usr/bin/env node
// doctor: read-only health check of the local workspace against config/layout.json and repos.json.
//   node src/doctor.mjs [--strict]     exit 1 with --strict when anything is found
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { expand, repoGate } from './lib.mjs';

const here = new URL('..', import.meta.url);
const load = (f) => JSON.parse(readFileSync(new URL(f, here), 'utf8'));
const layout = load('config/layout.json');
// private repositories live in a sibling repo (workspace-private) and are merged in when it is present
const privateManifest = new URL('../workspace-private/repos.private.json', here);
const repos = [...load('repos.json').repos, ...(existsSync(privateManifest) ? JSON.parse(readFileSync(privateManifest, 'utf8')).repos : [])];
const strict = process.argv.includes('--strict');
const devRoot = expand(layout.dev.path);
const findings = {};
const add = (k, msg) => (findings[k] ??= []).push(msg);

// 1. declared layout
const unknown = (dir, allowed, allowFiles = []) => { if (!existsSync(dir)) return; for (const e of readdirSync(dir, { withFileTypes: true })) if (!e.isSymbolicLink() && !allowed.includes(e.name) && !allowFiles.some((p) => new RegExp(p).test(e.name))) add('unmanaged entries', `${dir}\\${e.name}`); };
unknown(devRoot, layout.dev.children);
unknown(expand(layout.home.path), layout.home.allow, layout.home.allowFiles);

// 2-4. names, secrets, large files under managed roots
const { copyNames, secretNames, prune, maxDepth, largeFileBytes } = layout.scan;
const walk = (dir, depth) => {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (new RegExp(copyNames, 'i').test(e.name)) add('copy-style names', p);
    if (new RegExp(secretNames, 'i').test(e.name)) add('secret-looking names', p);
    if (e.isDirectory()) { if (!prune.includes(e.name) && depth < maxDepth) walk(p, depth + 1); }
    else { try { if (statSync(p).size > largeFileBytes) add('files over 100 MB', `${p} (${Math.round(statSync(p).size / 1048576)} MB)`); } catch { /* unreadable */ } }
  }
};
for (const r of layout.scan.roots) if (existsSync(expand(r))) walk(expand(r), 0);

// 5. repositories: manifest versus disk, and each repo's gate
const manifestPaths = repos.map((r) => resolve(isAbsolute(expand(r.path)) ? expand(r.path) : join(devRoot, r.path)));
const found = [];
const findRepos = (dir, depth) => {
  if (!existsSync(dir) || depth > 3) return;
  if (existsSync(join(dir, '.git'))) { found.push(resolve(dir)); return; }
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && !prune.includes(e.name)) findRepos(join(dir, e.name), depth + 1);
};
findRepos(devRoot, 0);
for (const p of found) if (!manifestPaths.some((m) => m.toLowerCase() === p.toLowerCase())) add('repos not in repos.json', p);
for (const [i, p] of manifestPaths.entries()) {
  if (!existsSync(p)) { add('repos in repos.json but missing on disk', `${repos[i].name}: ${p}`); continue; }
  const g = repoGate(p);
  if (!g) { add('repos in repos.json that are not git repos', p); continue; }
  if (g.commits === 0) add('repos with no commits', repos[i].name);
  if (!g.remotes.length) add('repos with no remote', repos[i].name);
  if (g.unpushed > 0 && g.remotes.length) add('repos with un-pushed commits', `${repos[i].name} (${g.unpushed})`);
  if (g.dirty > 0) add('dirty working trees', `${repos[i].name} (${g.dirty} files)`);
}

// 6. the inbox
const inbox = join(expand('${HOME}'), 'Inbox');
for (const sub of ['Telegram', 'Downloads']) { const d = join(inbox, sub); if (existsSync(d)) { const n = readdirSync(d).length; if (n) add('inbox waiting to be swept', `${sub}: ${n} entries`); } }

const total = Object.values(findings).reduce((s, v) => s + v.length, 0);
console.log(`# workspace doctor: ${total} finding${total === 1 ? '' : 's'}\n`);
for (const [k, v] of Object.entries(findings)) { console.log(`## ${k} (${v.length})`); v.slice(0, 40).forEach((m) => console.log(`- ${m}`)); if (v.length > 40) console.log(`- ... ${v.length - 40} more`); console.log(''); }
process.exit(strict && total ? 1 : 0);
