#!/usr/bin/env node
// For every cloned repo in a scope: install dependencies where a lockfile exists and run `build` where one is defined.
// Used by the clone-to-green workflow to prove a fresh machine gets working code from git alone.
//   node scripts/verify-clones.mjs --scope=showcase
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRepos, reposInScope } from '../src/manifest.mjs';

const scope = (process.argv.find((a) => a.startsWith('--scope=')) ?? '--scope=showcase').split('=')[1];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cwd, args) => spawnSync(npm, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;
let failed = 0;
for (const repo of reposInScope(loadRepos(), scope)) {
  if (!existsSync(repo.abs)) { console.log(`- ${repo.name}: not cloned, skipped`); continue; }
  for (const dir of ['.', 'frontend', 'backend', 'web', 'api']) {
    const d = join(repo.abs, dir);
    if (!existsSync(join(d, 'package-lock.json'))) continue;
    const label = `${repo.name}/${dir}`;
    console.log(`::group::${label}`);
    const ok = run(d, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'])
      && (!JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).scripts?.build || run(d, ['run', 'build']));
    console.log('::endgroup::');
    console.log(`${ok ? 'green' : 'RED  '} ${label}`);
    if (!ok) failed++;
  }
}
process.exit(failed ? 1 : 0);
