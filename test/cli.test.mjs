import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reposInScope } from '../src/manifest.mjs';
import { pullRepo, pushRepo, statusOf, initEnv } from '../src/repo-ops.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const g = (dir, ...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });

function remoteWithCommit() {
  const t = mkdtempSync(join(tmpdir(), 'cli-'));
  const bare = join(t, 'remote.git'); execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  const seed = join(t, 'seed'); execFileSync('git', ['clone', '-q', bare, seed]); writeFileSync(join(seed, 'a.txt'), '1'); g(seed, 'add', '-A'); g(seed, 'commit', '-qm', 'one'); g(seed, 'push', '-q', 'origin', 'HEAD:main');
  return { t, bare, seed };
}

test('scopes select repos and a typo throws instead of selecting nothing', () => {
  const repos = [{ name: 'a', scopes: ['showcase'] }, { name: 'b', scopes: ['company'] }];
  const scopes = { showcase: 'x', company: 'y' };
  assert.deepEqual(reposInScope(repos, 'showcase', scopes).map((r) => r.name), ['a']);
  assert.equal(reposInScope(repos, 'all', scopes).length, 2);
  assert.throws(() => reposInScope(repos, 'showcas', scopes), /unknown scope/);
});

test('pull clones what is missing, fast-forwards, and skips dirty trees', () => {
  const { t, bare, seed } = remoteWithCommit();
  try {
    const repo = { name: 'r', remote: bare, abs: join(t, 'dev', 'r') };
    assert.equal(pullRepo(repo).result, 'cloned');
    assert.equal(pullRepo(repo).result, 'up to date');
    writeFileSync(join(seed, 'b.txt'), '2'); g(seed, 'add', '-A'); g(seed, 'commit', '-qm', 'two'); g(seed, 'push', '-q', 'origin', 'HEAD:main');
    assert.equal(pullRepo(repo).result, 'fast-forwarded');
    writeFileSync(join(repo.abs, 'a.txt'), 'local edit');
    assert.match(pullRepo(repo).result, /skipped: 1 uncommitted/);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('push is a dry run by default and reports commits ahead; no commits and no remote are reported, never pushed', () => {
  const { t, bare } = remoteWithCommit();
  try {
    const repo = { name: 'r', remote: bare, abs: join(t, 'dev', 'r') };
    pullRepo(repo);
    writeFileSync(join(repo.abs, 'c.txt'), '3'); g(repo.abs, 'add', '-A'); g(repo.abs, 'commit', '-qm', 'local');
    assert.equal(statusOf(repo).ahead, 1);
    assert.match(pushRepo(repo).result, /would push 1/);
    assert.equal(statusOf(repo).ahead, 1, 'dry run must not push');
    assert.match(pushRepo(repo, { execute: true }).result, /pushed 1/);
    assert.equal(statusOf(repo).ahead, 0);
    const empty = join(t, 'empty'); execFileSync('git', ['init', '-q', empty]);
    assert.equal(statusOf({ name: 'e', abs: empty }).state, 'no-commits');
    assert.match(pushRepo({ name: 'e', abs: empty }).result, /no-commits/);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('env init generates secrets for placeholders and never overwrites', () => {
  const t = mkdtempSync(join(tmpdir(), 'env-'));
  try {
    writeFileSync(join(t, '.env.example'), 'PORT=3000\nJWT_SECRET=change-me\nDB_PASSWORD=\nAPI_KEY=real-looking-value\n');
    const repo = { name: 'r', abs: t };
    assert.match(initEnv(repo).result, /created/);
    const env = readFileSync(join(t, '.env'), 'utf8');
    assert.match(env, /^PORT=3000$/m); assert.match(env, /^JWT_SECRET=[0-9a-f]{48}$/m); assert.match(env, /^DB_PASSWORD=[0-9a-f]{48}$/m); assert.match(env, /^API_KEY=real-looking-value$/m);
    assert.match(initEnv(repo).result, /left untouched/);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('data-plane commands refuse on a dev machine and on a copied db-host role; allow on the real db-host', () => {
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  const run = (id, ...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, WORKSPACE_HOME: home, WORKSPACE_MACHINE_ID: id } });
  try {
    assert.equal(run('machine-A', 'data', 'up').status, 3, 'default role is dev');
    assert.equal(run('machine-A', 'role', 'set', 'db-host').status, 3, 'db-host needs --confirm');
    assert.equal(run('machine-A', 'role', 'set', 'db-host', '--confirm').status, 0);
    assert.equal(run('machine-A', 'data', 'up').status, 0, 'allowed on the machine that was made db-host');
    const copied = run('machine-B', 'data', 'up');
    assert.equal(copied.status, 3); assert.match(copied.stderr, /copied from another machine/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
