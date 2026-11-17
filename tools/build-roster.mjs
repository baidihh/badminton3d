import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHARACTERS } from '../public/js/characters.js';
import { loadGlb, packCharacter } from './pack-character.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const ids = process.argv.slice(2);
for (const id of ids) {
  if (!CHARACTERS.some(character => character.id === id)) throw new Error(`Unknown character: ${id}`);
}
const selected = ids.length ? CHARACTERS.filter(character => ids.includes(character.id)) : CHARACTERS;
const macBlender = '/Applications/Blender.app/Contents/MacOS/Blender';
const blender = process.env.BLENDER_PATH || [
  macBlender,
  path.join(root, '../tools/blender-runtime/blender-4.5.16-windows-x64/blender.exe'),
].find(candidate => existsSync(candidate)) || 'blender';
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'courtside-roster-'));

try {
  const source = await loadGlb(path.join(root, 'models/Xbot.glb'));
  for (const { id } of selected) {
    const directory = path.join(scratch, id);
    await fs.mkdir(directory);
    const blend = path.join(root, 'art/characters/roster', id + '.blend');
    const result = spawnSync(blender, [
      '--background', blend, '--python-exit-code', '1',
      '--python', path.join(root, 'tools/export-lingchuan.py'), '--', directory, id,
    ], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${id} Blender export failed\n${result.stdout}\n${result.stderr}`);
    const skin = await loadGlb(path.join(directory, 'lingchuan-blender.glb'));
    if (!skin.scene.getObjectByName('roster-' + id)) throw new Error(`Missing Blender mesh for ${id}`);
    await fs.writeFile(path.join(directory, id + '.glb'), await packCharacter(source, skin));
    await fs.access(path.join(directory, 'lingchuan.png'));
    console.log(`Validated ${id}`);
  }

  // Every requested variant is validated before updating any public assets.
  for (const { id } of selected) {
    await fs.copyFile(path.join(scratch, id, id + '.glb'), path.join(root, 'models/characters', id + '.glb'));
    await fs.copyFile(path.join(scratch, id, 'lingchuan.png'), path.join(root, 'public/images/characters', id + '.png'));
  }
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
