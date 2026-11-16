# Local rabbit character assets

Both rabbit appearances are locally authored procedural geometry. They were created without paid tools or external image/model generation. They reuse the repository's existing Xbot skeleton and seven animation clips; they are not advertised as AI-generated models.

- `public/js/rabbit-kit.js`: `addRabbitKit(root, bones, accent)` assembles the faceted rabbit on a supplied, normalized rig. It hides the athlete skin and attaches each part to its joint without changing any bone transform. `createRabbitParts` shares the authored shapes with the offline build.
- `tools/build-rabbit.mjs`: deterministic GLB build using the installed Three.js exporter. Run `node tools/build-rabbit.mjs` from the project root.
- `models/characters/rabbit.glb`: texture-free smooth rabbit, with eight visible `SkinnedMesh` material batches. Its original Mixamo joints, local axes, arm reach and animation tracks are retained.

The design has a cream oversized head, tall pink-lined ears, dark oval eyes with two highlights, pink cheeks and nose, a club-badge team jersey, navy shorts, mitten paws, cotton tail and chunky cream trainers with blue tongues and laces. The geometric version uses flat-shaded lower-resolution shapes and separate joint segments; the exported version uses smooth normals and continuous arms and legs with blended elbow/knee weights. The torso blends hips/spine influence. Face, ears, paws and shoes follow their appropriate joints rigidly, as intended for these features.

`Rabbit team shirt` retains `material.userData.teamColor === true` through a GLB round trip. The jersey, sleeves and shoe tongues share this recolorable material. Cream fur, eyes, pink features, navy shorts, trim and soles keep their separate original materials.

The original bone measurements are unchanged: foot Y 0.084414, head-end Y 1.774613. The existing normalization uses `1.82 / (headEndY - footY + 0.07)`; ears never affect this measurement. Source-space rabbit skin bounds are X −0.828332…0.828332, Y 0.084414…2.347209, Z −0.259239…0.284022. Thus the normalized visible height, including ears, is about 2.340 m while effective skeleton height remains 1.82 m. Long original limbs deliberately preserve the server's reachable contacts rather than shortening the skeleton for a stronger chibi proportion. Soles align with the ankle floor to avoid sinking below the normalized ground.

The GLB is 4,110,400 bytes, with 35,745 vertices, 63,028 triangles, eight material batches and 934 vertices carrying nontrivial two-bone blends. Two consecutive rebuilds produced the same SHA-256: `80bfe6d81859680041073ab68741d101e08bc8b28b47caa70a2b74718a84ebd7`.

Validation performed:

- Initial asset tests failed for the missing assets before implementation; the floor regression also failed before correcting soles and capsule caps.
- `node --test test/rabbit-asset.test.js`: 9/9 pass. Checks standalone GLB parsing, visible skin and retained material metadata, original joint positions/axes/clips, actual clip binding, normalized blended weights, independent clones, both elbows deforming visible vertices, faceted joint attachments, floor alignment, decorative ear sizing and both rabbit variants reaching authoritative contacts with either hand.
- `npm test`: 73/73 pass at asset handoff, including the three existing rig tests.
- Offline front/three-quarter triangle preview was inspected for silhouette, colors and face placement. Final WebGL lighting and desktop/mobile comparison-page QA belong to the integration review.

These are demonstration assets with static facial expressions and ears, simple mitten hands and layered procedural clothing. They do not include facial blend shapes, fur textures, cloth simulation or an optimized mobile LOD. Very deep limb folds may show overlap between the deliberately layered sleeves/shorts and fur; standard idle/run and gameplay IK remain compatible. No runtime dependencies were added.
