#!/usr/bin/env node
// apply: executes one batch of a manifest, or undoes a previous run. Dry run unless --execute.
//   node src/apply.mjs --manifest moves.json --batch A [--execute] [--log <dir>]
//   node src/apply.mjs --undo <undo-file.json> [--execute]
// Moves are renames on the same volume (instant, nothing is read or rewritten). Nothing is ever deleted.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, cpSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { driveOf } from './lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : a), []));

const free = (p) => { if (!existsSync(p)) return p; const dot = p.lastIndexOf('.'); const [b, e] = dot > p.lastIndexOf('\\') && dot > p.lastIndexOf('/') && dot > 0 ? [p.slice(0, dot), p.slice(dot)] : [p, '']; let n = 2; while (existsSync(`${b} (moved-${n})${e}`)) n++; return `${b} (moved-${n})${e}`; };

export function run(manifest, batch, { execute = false, ignoreGate = false } = {}) {
  const done = [], skipped = [];
  for (const o of manifest.filter((x) => x.batch === batch && x.to && ['move', 'quarantine'].includes(x.action))) {
    if (!existsSync(o.from)) { skipped.push({ ...o, why: 'source no longer exists' }); continue; }
    // a repo with un-pushed or uncommitted work is quarantined only after its work has been preserved (--ignore-gate)
    if (o.gate && !o.gateClean && o.action === 'quarantine' && !ignoreGate) { skipped.push({ ...o, why: 'repo gate not clean' }); continue; }
    if (o.op !== 'copy' && driveOf(o.from) !== driveOf(o.to)) { skipped.push({ ...o, why: 'different volume: rename impossible' }); continue; }
    const to = free(o.to);
    if (execute) {
      try {
        mkdirSync(dirname(to), { recursive: true });
        if (o.op === 'copy') cpSync(o.from, to, { recursive: true, errorOnExist: true, force: false });
        else renameSync(o.from, to);
        if (o.op === 'copy' && statSync(o.from).isFile() && statSync(to).size !== statSync(o.from).size) throw new Error('size mismatch after copy');
      } catch (e) { skipped.push({ ...o, why: `${e.code ?? 'error'}: ${e.message}` }); continue; }
    }
    done.push({ from: o.from, to, op: o.op ?? 'move', pendingOriginalRemoval: !!o.pendingOriginalRemoval });
  }
  return { done, skipped };
}

export function undo(log, { execute = false } = {}) {
  const restored = [], skipped = [];
  for (const d of [...log].reverse()) {
    if (d.op === 'copy') { skipped.push({ ...d, why: 'copies are not undone (the original was never removed)' }); continue; }
    if (existsSync(d.from) || !existsSync(d.to)) { skipped.push({ ...d, why: 'original path occupied or item missing' }); continue; }
    if (execute) { mkdirSync(dirname(d.from), { recursive: true }); renameSync(d.to, d.from); }
    restored.push(d);
  }
  return { restored, skipped };
}

if (process.argv[1]?.endsWith('apply.mjs')) {
  const execute = !!args.execute;
  if (args.undo) {
    const r = undo(JSON.parse(readFileSync(args.undo, 'utf8')), { execute });
    console.log(`${execute ? 'restored' : 'would restore'} ${r.restored.length}; skipped ${r.skipped.length}`);
    r.skipped.forEach((s) => console.log(`  skipped: ${s.to} (${s.why})`));
  } else {
    const m = JSON.parse(readFileSync(args.manifest, 'utf8'));
    const r = run(m, args.batch, { execute, ignoreGate: !!args['ignore-gate'] });
    console.log(`${execute ? 'done' : 'dry run'}: batch ${args.batch}: ${r.done.length} entries (${r.done.filter((d) => d.op === 'copy').length} copies); skipped ${r.skipped.length}`);
    r.skipped.forEach((s) => console.log(`  skipped: ${s.from} (${s.why})`));
    if (execute) {
      const dir = args.log ?? dirname(args.manifest);
      const file = join(dir, `undo-${args.batch}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      writeFileSync(file, JSON.stringify(r.done, null, 2));
      console.log(`undo log: ${file}`);
    }
  }
}
