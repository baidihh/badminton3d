import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

test('staged motion validation reads the candidate module before publication', async () => {
  const { stagedModuleImport } = await import('../tools/motion-import.mjs').catch(() => ({}));
  assert.equal(typeof stagedModuleImport, 'function', 'validate staged bytes rather than the published module');
  const directory = await mkdtemp(path.join(tmpdir(), 'court-motion-hook-'));
  try {
    const published = path.join(directory, 'published.mjs');
    const candidate = path.join(directory, 'candidate.mjs');
    await writeFile(published, 'export const value = 1;');
    await writeFile(candidate, 'export const value = 42;');
    const script = `import { value } from ${JSON.stringify(pathToFileURL(published).href)}; if (value !== 42) process.exit(2);`;
    const result = spawnSync(process.execPath, ['--import', stagedModuleImport(published, candidate), '--input-type=module', '--eval', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('motion contract rejects stale bytes, incompatible rigs and shifted backhand contact timing', async () => {
  const { validateMotionManifest } = await import('../tools/motion-import.mjs').catch(() => ({}));
  assert.equal(typeof validateMotionManifest, 'function');
  const bytes = Buffer.from('fixture');
  const manifest = {
    schemaVersion: 1, rig: 'xbot-world-bind-v1',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    coordinates: { up: '+Y', net: '-Z', racketSide: '+X', unit: 'meter' },
    clips: ['backhand_straight', 'backhand_cross'].map(name => ({ name, duration: 6, contact: .5 })),
    markers: ['RacketRoot', 'RacketGrip', 'RacketContact', 'RacketFaceNormal']
  };
  assert.doesNotThrow(() => validateMotionManifest(manifest, bytes));
  assert.throws(() => validateMotionManifest(manifest, Buffer.from('other')), /校验/);
  assert.throws(() => validateMotionManifest({ ...manifest, rig: 'unknown' }, bytes), /骨架/);
  assert.throws(() => validateMotionManifest({ ...manifest, clips: manifest.clips.map(clip => ({ ...clip, contact: .65 })) }, bytes), /触球/);
});

test('default Court Lab source is the sibling checkout and explicit paths take priority', async () => {
  const { courtLabDirectory } = await import('../tools/motion-import.mjs').catch(() => ({}));
  assert.equal(typeof courtLabDirectory, 'function');
  assert.equal(courtLabDirectory(undefined, {}), path.resolve(import.meta.dirname, '../../forehand-lab'));
  assert.equal(courtLabDirectory('chosen', { COURT_LAB_DIR: 'configured' }), path.resolve('chosen'));
  assert.equal(courtLabDirectory(undefined, { COURT_LAB_DIR: 'configured' }), path.resolve('configured'));
});
