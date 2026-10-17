import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest } from '../src/inventory.mjs';

const base = JSON.parse(readFileSync(new URL('../config/cleanup.example.json', import.meta.url), 'utf8'));

// Regression: a root written with forward slashes (as ${HOME}/OneDrive/Desktop expands on Windows) must still be recognised as OneDrive,
// otherwise a document that should be COPIED out of OneDrive would be moved.
test('forward-slash roots still trigger the OneDrive copy rule', async () => {
  const t = mkdtempSync(join(tmpdir(), 'ws-'));
  try {
    const od = join(t, 'onedrive', 'Desktop'); mkdirSync(od, { recursive: true });
    mkdirSync(join(od, 'resume')); writeFileSync(join(od, 'resume', 'cv.docx'), 'x');
    const cfg = { vault: join(t, 'Vault'), dev: join(t, 'dev'), runtime: join(t, 'rt'), quarantine: join(t, 'q'), roots: [{ label: 'onedrive-desktop', path: od.replace(/\\/g, '/') }], keepNewest: base.keepNewest, rules: base.rules };
    const m = await buildManifest(cfg, {});
    assert.equal(m.find((o) => o.name === 'resume').op, 'copy');
  } finally { rmSync(t, { recursive: true, force: true }); }
});
