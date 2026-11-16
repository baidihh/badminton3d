# Locally authored character roster

`public/js/roster-kit.js` exports `addRosterKit(root, bones, character)`. Pass a normalized Xbot rig and a registered character with an `avatar` key. Optional `character.palette` overrides accept `skin`, `top`, `bottom`, `accent`, and `hair` hex colors. The function returns `{ meshes, materials }`, hides the source athlete skin, and attaches generated shapes to the existing bones. The primary head mesh is named `roster-${character.avatar}` for integration checks.

All six appearances are locally authored geometric assets, with no external generation, paid tools, textures, or added runtime dependencies. The audience ranges describe the visual design; every character remains available to everyone. Original bone positions, local axes, shoulder reach and sizing joints remain unchanged. Effective gameplay height stays 1.82 m. Decorative ears, hairstyles, spikes and tails do not alter the sizing joint or physical reach.

| Avatar | Design audience | Distinguishing geometry and outfit | Visible triangles | Meshes |
| --- | --- | --- | ---: | ---: |
| `dino` | 0–8 | Orange dinosaur, rounded cream muzzle, raised expressive eyes, mint dorsal spikes, tapered tail, mint piped jersey | 16,704 | 75 |
| `kitten` | 0–8 | Cream cat, rounded triangular ears with rose lining, whiskers, forehead markings, curled tail, rose jersey | 19,496 | 80 |
| `junior-boy` | 9–17 | Cropped dark hair with sculpted tufts, yellow headband, blue sports jersey and navy shorts | 19,084 | 80 |
| `junior-girl` | 9–17 | Side fringe and curved ponytail, pale green headband, lilac jersey, pleated skort over sports shorts | 20,988 | 90 |
| `young-man` | 18–30 | Swept quiff, trimmed sideburns, navy jersey with amber diagonal piping, darker shorts | 19,876 | 84 |
| `young-woman` | 18–30 | Sculpted bun and swept fringe, teal hair ribbon, cream sleeveless zip vest, teal shorts | 20,164 | 85 |

Every look includes smooth rough materials, eye catchlights, cheeks, a smile, club badge, contrast collar and side panels, wristbands, socks and shaped trainers with soles, tongues and laces. Human face size and hairstyles vary from the larger mascot heads. Individual outfit colors are authored palettes rather than global team-color replacements. Geometry and materials are allocated per character instance; no mutable resource is shared across players. Within one instance, small spheres share geometry for efficient allocation and safe set-based disposal.

The original long limbs are intentionally retained for fair gameplay. This gives the youngest mascot looks a sporting body proportion rather than physically shortening their bones. Tails and hair follow their parent joints rigidly. These appearances do not add facial animation, hair physics, cloth simulation or new skinned meshes. Layered geometry can overlap in deep limb folds; they are suited to the existing idle, footwork and racket poses. Counts are geometry budgets, not measured mobile frame rates.

Verification:

- `node --test test/roster-assets.test.js`: 12 tests covering all six looks. Each has complete visible geometry and its named distinguishing feature, unchanged gameplay joint matrices, less than 40,000 triangles, ground-aligned soles, visible eye highlights and badges, finite geometry/transforms through repeated posing, and head features that follow actual vertex motion with the head bone.
- The tests initially failed for the absent module before implementation. A test assumption about a curve mesh's origin was corrected to inspect an actual vertex, so the movement assertion checks the visible feature instead of its arbitrary object origin.
- Offline six-character three-quarter preview inspected together; final adjustments raised the dinosaur eyes above its muzzle and surfaced cat forehead markings, cropped fringe and headbands.
- Fresh `npm test` at handoff: 99/99 pass, including the parent integration tests that verify both hands reaching authoritative contacts for all six roster entries.
- Integration owns registry entries, PlayerView selection, gallery rendering, portrait export and final browser checks. No changes to those files were made by the asset task.
