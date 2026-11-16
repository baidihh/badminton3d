import fs from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// Texture-free Blender characters only need binary FileReader in Node.
if (!globalThis.FileReader) globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); });
  }
};

export async function loadGlb(file) {
  const bytes = await fs.readFile(file);
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

export async function packCharacter(source, skinned) {
  const animations = source.animations.filter(clip => ['idle', 'walk', 'run'].includes(clip.name));
  if (animations.length !== 3) throw new Error('The shared rig is missing idle, walk or run');

  // Match local coordinate systems for every animated joint, including the
  // centimeter-scale root. Court Lab poses and the runtime IK share this rig.
  const targets = new Set(animations.flatMap(clip => clip.tracks.map(track => track.name.split('.')[0])));
  for (const name of targets) {
    const old = source.scene.getObjectByName(name);
    const next = skinned.scene.getObjectByName(name);
    if (!old?.isBone || !next?.isBone || old.parent.name !== next.parent.name ||
        old.position.distanceTo(next.position) > .002 || old.quaternion.angleTo(next.quaternion) > .001 ||
        old.parent.scale.distanceTo(next.parent.scale) > .001) {
      throw new Error(`The Blender export changed the shared rig at ${name}`);
    }
  }
  const data = await new GLTFExporter().parseAsync(skinned.scene, { binary: true, animations });
  return Buffer.from(data);
}
