# Courtside coastal arena

`public/js/coastal-arena.js` exports `applyCoastalArena({ scene, renderer, floor, outer, key, rim, warm, netMesh, netTape })`. Call it after the existing net posts are added and before loading players. It returns a named `coastal-arena` group. Repeating the call on the same scene returns the installed group without rebuilding textures or duplicating decoration.

The club is a sunny sporting island: muted teal rubber court, coral edge strips, mint run-off apron, cream sand paving and terraces, mint/coral cushions, eight curved palms, striped parasols, benches, low sideline barriers, distant ocean/foam and soft cloud clusters. Procedural canvas banners and end-apron lettering carry the `COURTSIDE / COASTAL BADMINTON CLUB` identity. No downloaded images, external fonts, dependencies or paid assets are used.

The original floor geometry, rotation and 16 × 26 m UV mapping are retained. The replacement court texture is 1536 × 2496 pixels and is deterministic. Court edges remain X ±3 m, Z ±6.7 m. Short service lines are Z ±1.98 m, long service lines Z ±5.94 m, center service lines run only outside the short-service region, and inner singles sidelines are X ±2.59 m. Pale white lines contrast with the teal surface; all apron type and decoration sit outside the playable bounds. `floor.userData.coastalCourt` and the returned group's `userData` expose the measurements for inspection.

The installer recognizes only the existing stadium's explicit geometry signatures: radius-30 dome and roof, the old side/end step dimensions, LED strips, 360-instance audience dots, advertisement boxes and high overhead lighting discs. Those objects are hidden. The floor, outer ground, existing light objects, net mesh and tape, net posts/bases and training-marker group remain in place. Net and post materials are recolored, while their geometry and transforms remain unchanged. The lighter hemisphere and directional-light colors keep warm sun shadows and cool sky fill; exposure is set to 1.03. No player, ball, camera, physics, collision, training or frame-loop code is changed here.

The new layer contains 80 visible meshes, including six instanced batches for palm trunks, two frond shades, coconuts, terrace cushions and clouds. The scene adds 11,496 visible triangles including instances. Each parasol uses two material groups for alternating cream/color panels. These are geometry counts, not measured FPS. The layer is static and requires no per-frame update. Procedural textures are allocated once per scene; no teardown or theme-switch API is provided.

Validation performed:

- Before implementation, a smoke check failed because the module did not exist.
- `node --check public/js/coastal-arena.js` passes.
- A temporary Node/Three.js fixture verified repeated-call identity, selective hiding of old stadium pieces, preservation of net geometry/post transforms/training visibility, texture dimensions, court metadata and finite matrices.
- Every decoration's transformed geometry bounds was checked individually, including every instance, against the playable volume X ±3, Z ±6.7, Y 0.05–4 m. None intersects it. Terraces, palms, parasols, signs and benches therefore leave the court clear.
- Fresh full `npm test`: 102/102 pass at handoff.
- Parent integration owns the final browser screenshot and lighting review, since the temporary fixture validates geometry and coordinates without rendering the canvas textures in WebGL.
