// Machine identity and role. The role file is untracked, in the user's home, and never leaves the machine.
//   dev      (default) local compose database per app; no tunnel, no backups
//   db-host  this machine only: the data-plane commands are allowed here and refuse everywhere else
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir, hostname, platform } from 'node:os';
import { dirname, join } from 'node:path';

const file = () => join(process.env.WORKSPACE_HOME ?? join(homedir(), '.workspace'), 'machine.json');
const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };

/** A stable hash of this machine's hardware or OS identity; the raw id is never stored. */
export function machineId() {
  if (process.env.WORKSPACE_MACHINE_ID) return createHash('sha256').update(process.env.WORKSPACE_MACHINE_ID).digest('hex');
  let raw = '';
  if (platform() === 'win32') raw = run('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_ComputerSystemProduct).UUID']);
  else if (platform() === 'darwin') raw = run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']).match(/IOPlatformUUID" = "([^"]+)/)?.[1] ?? '';
  else raw = (existsSync('/etc/machine-id') ? readFileSync('/etc/machine-id', 'utf8') : '').trim();
  return createHash('sha256').update(raw || hostname()).digest('hex');
}

export function readRole() {
  if (!existsSync(file())) return { role: 'dev' };
  try { return JSON.parse(readFileSync(file(), 'utf8')); } catch { return { role: 'dev' }; }
}

export function setRole(role, { confirm = false } = {}) {
  if (!['dev', 'db-host'].includes(role)) throw new Error(`unknown role "${role}" (dev or db-host)`);
  if (role === 'db-host' && !confirm) throw new Error('db-host makes this machine the database host for the whole workspace. Re-run with --confirm on the one machine that should be it.');
  mkdirSync(dirname(file()), { recursive: true });
  const value = role === 'db-host' ? { role, machine: machineId(), since: new Date().toISOString() } : { role };
  writeFileSync(file(), JSON.stringify(value, null, 2));
  return value;
}

/** Data-plane commands call this first. They run only on the machine that was explicitly made the db-host. */
export function assertDbHost() {
  const r = readRole();
  if (r.role !== 'db-host') throw new Error('this machine is a "dev" machine; data-plane commands run only on the db-host. Use `workspace up <app>` for a local database.');
  if (r.machine !== machineId()) throw new Error('the db-host role on this machine was copied from another machine; refusing. Run `workspace role set db-host --confirm` here only if this is the host.');
  return r;
}
