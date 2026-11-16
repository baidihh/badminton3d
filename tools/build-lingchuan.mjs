// Build the desktop-editable skin and the game's compact runtime asset.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGlb, packCharacter } from './pack-character.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'badminton-lingchuan-'));
const macBlender = '/Applications/Blender.app/Contents/MacOS/Blender';
const blender = process.env.BLENDER_PATH || (existsSync(macBlender) ? macBlender : 'blender');
const editable = path.join(project, 'art/characters/lingchuan.blend');
const seed = process.argv.includes('--seed');

function runBlender(args, script) {
  const result = spawnSync(blender, [
    '--background', ...args, '--python-exit-code', '1',
    '--python', path.join(project, 'tools', script), '--', scratch,
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Blender export failed (${result.status ?? result.signal})`);
}

async function publish(file, bytes) {
  const staged = `${file}.${path.basename(scratch)}.tmp`;
  try {
    await fs.writeFile(staged, bytes, { flag: 'wx' });
    await fs.rename(staged, file);
  } finally {
    await fs.rm(staged, { force: true });
  }
}

try {
  const blend = seed ? path.join(scratch, 'lingchuan.blend') : editable;
  if (seed) runBlender(['--factory-startup'], 'build-lingchuan.py');
  runBlender([blend], 'export-lingchuan.py');

  const [source, skinned] = await Promise.all([
    loadGlb(path.join(project, 'models/Xbot.glb')),
    loadGlb(path.join(scratch, 'lingchuan-blender.glb')),
  ]);
  const data = await packCharacter(source, skinned);
  const portrait = await fs.readFile(path.join(scratch, 'lingchuan.png'));
  if (seed) await publish(editable, await fs.readFile(blend));
  await publish(path.join(project, 'models/characters/lingchuan.glb'), data);
  await publish(path.join(project, 'public/images/characters/young-man.png'), portrait);
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
