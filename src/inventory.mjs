#!/usr/bin/env node
// inventory: read-only. Walks the roots in a phase config, classifies every top-level entry by name and extension
// (no file is opened except to hash it), and writes a manifest of intended operations.
//   node src/inventory.mjs --config config/cleanup.example.json --out <dir> [--company-root <path>] [--no-hash]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { classify, expand, gateIsClean, isEmptyTree, listDir, onlyLockFiles, repoGate, sha256 } from './lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : a), []));
const date = new Date().toISOString().slice(0, 10);

export async function buildManifest(cfg, vars, { hash = true } = {}) {
  const x = (v) => expand(v, vars);
  const vault = x(cfg.vault), dev = x(cfg.dev), quarantine = join(x(cfg.quarantine), date);
  // resolve() normalises separators: ${HOME}/OneDrive/Desktop must compare equal to the backslash paths readdir yields
  const roots = cfg.roots.map((r) => ({ ...r, path: resolve(x(r.path)) }));
  const oneDriveRoots = roots.filter((r) => r.label.startsWith('onedrive')).map((r) => r.path.toLowerCase());
  const resolveDest = (r, entry) => {
    const [kind, rest = ''] = r.dest.includes(':') ? [r.dest.slice(0, r.dest.indexOf(':')), r.dest.slice(r.dest.indexOf(':') + 1)] : ['', r.dest];
    const base = { vault, dev, runtime: x(cfg.runtime), home: x('${HOME}'), 'onedrive-desktop': roots.find((q) => q.label === 'onedrive-desktop')?.path }[kind];
    if (!base) throw new Error(`unknown destination base in "${r.dest}"`);
    const sub = rest.replace('{lower}', entry.name.toLowerCase()).replace('{name}', entry.name);
    // a directory's dest is its final path; a file's dest is the folder it goes into
    return entry.type === 'dir' ? join(base, sub) : join(base, sub, entry.name);
  };
  const entries = [];
  for (const root of roots) {
    if (!existsSync(root.path)) continue;
    for (const e of listDir(root.path)) {
      if (root.skip?.includes(e.name)) continue;
      const r = classify(e, cfg.rules.filter((q) => !q.special), root.label);
      let rule = r;
      // a rule named for this root (leave, hold, move) always beats a content check: application folders that happen to be empty stay put
      const named = r?.roots?.includes(root.label) && !r.fallback;
      if (e.type === 'dir' && !root.only && !named) {
        // content checks (empty folder, only Office lock files) apply to whole-folder roots, never to the 'only' roots (home, company root)
        for (const s of cfg.rules.filter((q) => q.special)) {
          if (s.roots && !s.roots.includes(root.label)) continue;
          try { if ((s.special === 'empty' && isEmptyTree(e.path)) || (s.special === 'onlyLockFiles' && onlyLockFiles(e.path))) { rule = s; break; } } catch { /* unreadable or dangling link: no content verdict */ }
        }
      }
      // 'only' roots (home, company root) take named rules only: the generic document rules must never sweep them
      if (root.only && !(rule?.roots ?? []).includes(root.label)) continue;
      if (!rule) continue;
      if (rule.action === 'leave') continue;
      entries.push({ root: root.label, entry: e, rule });
    }
  }
  // newest-N archives rule
  const kn = cfg.keepNewest;
  const group = entries.filter((q) => kn && q.entry.type === 'file' && q.root === kn.roots[0] && new RegExp(kn.match, 'i').test(q.entry.name)).sort((a, b) => b.entry.mtime - a.entry.mtime);
  group.forEach((q, i) => { q.rule = i < kn.keep ? { action: 'move', dest: kn.keepDest, reason: `platform snapshot, kept (newest ${kn.keep})`, batch: 'B', type: 'file' } : { ...kn.rest, type: 'file' }; });

  const hashes = new Map();
  const out = [];
  for (const { root, entry: e, rule } of entries) {
    const o = { root, name: e.name, from: e.path, type: e.type, size: e.size, action: rule.action, batch: rule.batch ?? 'H', reason: rule.reason };
    if (e.type === 'dir') { const g = repoGate(e.path); if (g) { o.gate = g; o.gateClean = gateIsClean(g); } }
    if (rule.action === 'quarantine') o.to = join(quarantine, rule.reason.replace(/[^a-z0-9-]+/gi, '-'), e.name);
    if (rule.action === 'move') {
      o.to = resolveDest(rule, e);
      // a document leaving OneDrive is COPIED, not moved: OneDrive is today an unintended cloud backup, and the offsite backup does not exist yet
      const fromOneDrive = oneDriveRoots.some((p) => e.path.toLowerCase().startsWith(p));
      const toOneDrive = oneDriveRoots.some((p) => o.to.toLowerCase().startsWith(p));
      if (fromOneDrive && !toOneDrive && !rule.forceMove) { o.op = 'copy'; o.pendingOriginalRemoval = true; }
    }
    if (hash && e.type === 'file' && e.size < 300 * 1024 * 1024 && ['move', 'quarantine'].includes(rule.action)) {
      try { o.sha256 = await sha256(e.path); (hashes.get(o.sha256) ?? hashes.set(o.sha256, []).get(o.sha256)).push(o); } catch (err) { o.unreadable = err.code; }
    }
    out.push(o);
  }
  for (const list of hashes.values()) if (list.length > 1) list.slice(1).forEach((d) => { d.duplicateOf = list[0].from; });
  return out;
}

export function summarise(m) {
  const by = (k) => m.reduce((a, o) => ((a[o[k]] = (a[o[k]] ?? 0) + 1), a), {});
  const mb = (list) => (list.reduce((s, o) => s + o.size, 0) / 1048576).toFixed(0);
  const lines = ['# Phase 2 dry run', '', `Entries: ${m.length}. By batch: ${JSON.stringify(by('batch'))}. By action: ${JSON.stringify(by('action'))}.`, ''];
  for (const b of ['A', 'B', 'C', 'D', 'H']) {
    const list = m.filter((o) => o.batch === b);
    if (!list.length) continue;
    lines.push(`## Batch ${b} (${list.length} entries, ${mb(list)} MB of files)`);
    const groups = {};
    for (const o of list) (groups[`${o.action}${o.op ? '/' + o.op : ''} | ${o.reason}`] ??= []).push(o);
    for (const [k, g] of Object.entries(groups)) lines.push(`- ${k}: ${g.length}${g.some((o) => o.duplicateOf) ? ` (${g.filter((o) => o.duplicateOf).length} exact duplicates)` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

if (process.argv[1]?.endsWith('inventory.mjs')) {
  const cfg = JSON.parse(readFileSync(args.config, 'utf8'));
  const m = await buildManifest(cfg, { COMPANY_ROOT: args['company-root'] ?? process.cwd() }, { hash: !args['no-hash'] });
  mkdirSync(args.out, { recursive: true });
  writeFileSync(join(args.out, 'moves.json'), JSON.stringify(m, null, 2));
  writeFileSync(join(args.out, 'summary.md'), summarise(m));
  console.log(summarise(m));
}
