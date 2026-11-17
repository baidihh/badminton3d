import * as THREE from 'three';

// Both viewers use the same surface treatment, with independent owned materials.
export class AthleteMaterials {
  constructor(textures = {}) {
    this.textures = textures;
    this.enhanced = new Map();
    this.original = new Map();
  }

  material(base, hasUV) {
    const name = base.name || '';
    if (!base.isMeshStandardMaterial || !/^(Jersey|Shoulder panels|Shorts|Skin|Hair|Shoe upper|Eye ink|Eye gleam)$/.test(name)) return base;
    const key = `${base.uuid}-${hasUV}`;
    if (this.enhanced.has(key)) return this.enhanced.get(key);
    const material = new THREE.MeshPhysicalMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(material, base);
    material.defines = { ...material.defines, PHYSICAL: '' };
    material.envMapIntensity = .65;
    if (/^(Jersey|Shoulder panels|Shorts)$/.test(name)) {
      material.roughness = .82;
      material.sheen = .42;
      material.sheenRoughness = .8;
      material.sheenColor.copy(base.color).lerp(new THREE.Color('#c9d4d5'), .25);
      if (hasUV && this.textures.normal) {
        material.normalMap = this.textures.normal;
        material.normalScale.set(.18, .18);
        material.roughnessMap = this.textures.roughness || null;
      }
    } else if (name === 'Skin') {
      material.roughness = .54;
      material.specularIntensity = .4;
      material.clearcoat = .04;
      material.clearcoatRoughness = .7;
    } else if (/^Eye/.test(name)) {
      material.roughness = .16;
      material.clearcoat = .3;
    } else if (name === 'Hair') {
      material.roughness = .38;
      material.specularIntensity = .55;
    }
    this.enhanced.set(key, material);
    this.original.set(material, base);
    return material;
  }

  apply(root, refined = true) {
    root.traverse(mesh => {
      if (!mesh.isMesh) return;
      const transform = current => {
        const base = this.original.get(current) || current;
        return refined ? this.material(base, Boolean(mesh.geometry.attributes.uv)) : base;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(transform) : transform(mesh.material);
    });
  }

  dispose() {
    for (const material of this.enhanced.values()) material.dispose();
    this.enhanced.clear();
    this.original.clear();
  }
}

export async function loadFabricTextures(baseURL, anisotropy = 4) {
  const loader = new THREE.TextureLoader();
  const results = await Promise.allSettled(['fabric-normal.jpg', 'fabric-roughness.jpg'].map(file => loader.loadAsync(baseURL + file)));
  const textures = {};
  for (const [i, result] of results.entries()) {
    if (result.status !== 'fulfilled') continue;
    const texture = result.value;
    texture.flipY = false;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(12, 12);
    texture.anisotropy = Math.min(4, anisotropy);
    textures[i === 0 ? 'normal' : 'roughness'] = texture;
  }
  return textures;
}
