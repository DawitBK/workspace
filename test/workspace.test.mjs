import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest } from '../src/inventory.mjs';
import { run, undo } from '../src/apply.mjs';

const base = JSON.parse(readFileSync(new URL('../config/cleanup.example.json', import.meta.url), 'utf8'));

function fixture() {
  const t = mkdtempSync(join(tmpdir(), 'ws-'));
  const dl = join(t, 'inbox'); const home = join(t, 'home'); const od = join(t, 'onedrive');
  mkdirSync(dl); mkdirSync(home); mkdirSync(od);
  const f = (dir, name, body = 'x') => writeFileSync(join(dir, name), body);
  f(dl, 'My Resume.pdf'); f(dl, 'cbe_receipt_1.pdf'); f(dl, 'holiday.jpg'); f(dl, '~$lock.docx'); f(dl, 'mystery.bin2'); f(dl, 'copy-a.pdf', 'same'); f(dl, 'copy-b.pdf', 'same');
  mkdirSync(join(dl, 'emptydir')); mkdirSync(join(dl, 'shell')); f(join(dl, 'shell'), '~$only.xlsx');
  f(home, 'setup-agent.exe'); f(home, 'unrelated.txt'); f(home, 'admin_token.txt', 'secret-not-read');
  mkdirSync(join(od, 'resume')); f(join(od, 'resume'), 'cv.docx'); f(od, 'a.lnk');
  const cfg = {
    vault: join(t, 'Vault'), dev: join(t, 'dev'), runtime: join(t, 'runtime'), quarantine: join(t, 'q'),
    roots: [{ label: 'telegram', path: dl }, { label: 'home', path: home, only: true }, { label: 'onedrive-desktop', path: od }],
    keepNewest: base.keepNewest, rules: base.rules,
  };
  return { t, cfg };
}

test('classification by name and extension; unlisted home files are left alone', async () => {
  const { t, cfg } = fixture();
  try {
    const m = await buildManifest(cfg, {});
    const by = (n) => m.find((o) => o.name === n);
    assert.match(by('My Resume.pdf').to, /Identity-and-Career/);
    assert.match(by('cbe_receipt_1.pdf').to, /Finance/);
    assert.match(by('holiday.jpg').to, /Media/);
    assert.equal(by('~$lock.docx').action, 'quarantine');
    assert.match(by('mystery.bin2').to, /_to-review/);
    assert.equal(by('emptydir').reason, 'empty-folders');
    assert.equal(by('shell').reason, 'office-lock-shell');
    assert.match(by('setup-agent.exe').to, /installers/);
    assert.match(by('admin_token.txt').to, /sensitive/);
    assert.equal(by('unrelated.txt'), undefined, 'generic rules must not sweep the home folder');
    assert.equal(by('copy-b.pdf').duplicateOf, by('copy-a.pdf').from);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('documents leaving OneDrive are copied, shortcuts stay inside it', async () => {
  const { t, cfg } = fixture();
  try {
    const m = await buildManifest(cfg, {});
    const resume = m.find((o) => o.name === 'resume');
    assert.equal(resume.op, 'copy'); assert.ok(resume.pendingOriginalRemoval);
    assert.equal(m.find((o) => o.name === 'a.lnk').op, undefined);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('dry run changes nothing; execute moves; undo restores; nothing is deleted', async () => {
  const { t, cfg } = fixture();
  try {
    const m = await buildManifest(cfg, {});
    const src = join(t, 'inbox', 'holiday.jpg');
    run(m, 'B', { execute: false });
    assert.ok(existsSync(src), 'dry run must not move');
    const r = run(m, 'B', { execute: true });
    assert.ok(!existsSync(src)); assert.ok(r.done.some((d) => d.to.endsWith('holiday.jpg') && existsSync(d.to)));
    assert.ok(existsSync(join(t, 'onedrive', 'resume', 'cv.docx')), 'OneDrive original is kept after a copy');
    const u = undo(r.done, { execute: true });
    assert.ok(existsSync(src)); assert.ok(u.skipped.every((s) => s.why.startsWith('copies')));
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('a name collision never overwrites', async () => {
  const { t, cfg } = fixture();
  try {
    const m = await buildManifest(cfg, {});
    mkdirSync(join(t, 'Vault', 'Media'), { recursive: true });
    writeFileSync(join(t, 'Vault', 'Media', 'holiday.jpg'), 'existing');
    const r = run(m, 'B', { execute: true });
    assert.equal(readFileSync(join(t, 'Vault', 'Media', 'holiday.jpg'), 'utf8'), 'existing');
    assert.ok(r.done.some((d) => d.to.includes('(moved-2)')));
  } finally { rmSync(t, { recursive: true, force: true }); }
});
