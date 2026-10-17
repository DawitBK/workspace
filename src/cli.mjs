#!/usr/bin/env node
// workspace: bring the right slice of the organised repo set to this machine, by scope, with plain git.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRepos, loadScopes, reposInScope } from './manifest.mjs';
import { readRole, setRole, assertDbHost, machineId } from './machine.mjs';
import { initEnv, pullRepo, pushRepo, statusOf } from './repo-ops.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const positional = rest.filter((a) => !a.startsWith('--'));
const scopeFlag = flags.scope ?? 'showcase';
const table = (rows) => rows.forEach((r) => console.log(Object.values(r).join('  ')));

const usage = `workspace <command>
  status [--scope=S] [--fetch]      ahead, behind, dirty, no-commits per repo
  pull   [--scope=S]                clone what is missing, fast-forward the rest (skips dirty trees)
  push   [--scope=S] [--execute]    dry run by default; never forces
  doctor [--strict]                 read-only health check
  env init <repo>                   .env from .env.example with generated secrets
  up <repo>                         local dev stack: compose database, migrate, seed
  role show | role set <dev|db-host> [--confirm]
  data up|backup|restore|tunnel     data-plane commands: only on the db-host machine
scopes: ${Object.keys(loadScopes()).join(', ')}, all`;

try {
  switch (cmd) {
    case 'status': table(reposInScope(loadRepos(), scopeFlag).map((r) => statusOf(r, { fetch: !!flags.fetch }))); break;
    case 'pull': table(reposInScope(loadRepos(), scopeFlag).map(pullRepo)); break;
    case 'push': table(reposInScope(loadRepos(), scopeFlag).map((r) => pushRepo(r, { execute: !!flags.execute }))); break;
    case 'doctor': { const r = spawnSync(process.execPath, [fileURLToPath(new URL('./doctor.mjs', import.meta.url)), ...(flags.strict ? ['--strict'] : [])], { stdio: 'inherit' }); process.exit(r.status ?? 1); break; }
    case 'env': { if (positional[0] !== 'init' || !positional[1]) throw new Error('usage: workspace env init <repo>'); const r = loadRepos().find((x) => x.name === positional[1]); if (!r) throw new Error(`unknown repo ${positional[1]}`); table([initEnv(r)]); break; }
    case 'up': {
      const r = loadRepos().find((x) => x.name === positional[0]); if (!r) throw new Error(`unknown repo ${positional[0]}`);
      const compose = ['compose.dev.yml', 'docker-compose.dev.yml'].map((f) => join(r.abs, f)).find(existsSync);
      if (!compose) throw new Error(`${r.name} has no compose.dev.yml`);
      for (const step of [['docker', ['compose', '-f', compose, 'up', '-d']], ...['db:migrate', 'db:seed'].filter((s) => JSON.parse(readFileSync(join(r.abs, 'package.json'), 'utf8')).scripts?.[s]).map((s) => ['pnpm', ['run', s]])]) {
        const x = spawnSync(step[0], step[1], { cwd: r.abs, stdio: 'inherit', shell: process.platform === 'win32' }); if (x.status) process.exit(x.status);
      }
      break;
    }
    case 'role': {
      if (positional[0] === 'set') console.log(setRole(positional[1], { confirm: !!flags.confirm }));
      else console.log({ ...readRole(), thisMachine: machineId().slice(0, 12) });
      break;
    }
    case 'data': { assertDbHost(); console.log(`data ${positional[0] ?? ''}: allowed on this db-host (the data plane itself arrives in Phase 9)`); break; }
    default: console.log(usage); process.exit(cmd ? 2 : 0);
  }
} catch (e) { console.error(`workspace: ${e.message}`); process.exit(3); }
