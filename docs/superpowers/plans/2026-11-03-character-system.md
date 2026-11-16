# Character System Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the asset task and independent final review; execute integration in this session. Steps use checkbox syntax for tracking.

**Goal:** Ship selectable athlete / geometric rabbit / skinned GLB rabbit, synchronized across phone and screen, with a live side-by-side comparison page.
**Architecture:** An allowlisted shared character registry describes assets and appearances. PlayerView preserves GLB materials and separates rig driving from appearance. An async character slot owns view replacement, caches source assets and handles fallback/races. Server snapshots own selection.
**Tech Stack:** Existing Three.js, vanilla browser modules, Node test runner, Socket.IO. No new runtime dependencies.
**Spec:** docs/character-system-research.md and user's approval to implement with two demos.

## Global Constraints
- Preserve the existing uncommitted training/game work and reuse the current checkout; do not commit unrelated changes or reset files.
- Two rabbit demos are locally authored assets, not advertised as AI-generated. Future AI GLB enters through the same validated registry.
- Character selection changes visuals only. Shared effective bone height, server physics and hit radius remain unchanged.
- Preserve default athlete and existing three rig tests. Character IDs: athlete, rabbit-geo, rabbit-glb.
- Unknown IDs, missing bones, asset failure and rapid switching must not crash or duplicate players.

## Review Focus
- Replaced/disconnected controller cannot change another player's appearance.
- Late completion of an old model load cannot replace the newest selection.
- Scene removal and material disposal cannot damage cached/shared assets.
- Imported material identity and socket transforms survive appearance changes.
- Mobile layout and comparison controls work without a controller connection.

### Task 1: Shared registry and synchronized selection
Files: public/js/characters.js, game/game.js, net/socket.js, server.js, test/socket.test.js.
Interfaces: CHARACTERS, getCharacter(id), isCharacterId(id); ctrl:character and game:character; snapshot.characterId and ctrl:tick characterId.
- [x] Write and run failing tests for valid IDs, invalid IDs, unowned slot, screen control and refresh/restart preservation.
- [x] Implement allowlisted selection and snapshot/tick recovery.
- [x] Add phone and screen selectors using server-confirmed state.
- [x] Verify relevant tests.

### Task 2: Local rabbit assets (delegated)
Files: public/js/rabbit-kit.js, tools/build-rabbit.mjs, models/characters/rabbit.glb, test/rabbit-asset.test.js.
Interfaces: addRabbitKit(root,bones,accent); glTF with Mixamo bone names, original animation compatibility and material userData.teamColor=true on recolorable shirt.
- [x] Write asset tests for visible skin, required joints, independent skeleton and retained materials.
- [x] Produce visually distinct faceted assembled rabbit and smooth clothed skinned rabbit. Preserve Xbot effective shoulder/arm reach; exclude decorative ears from sizing.
- [x] Build reproducible GLB with real skin weights and export animation clips.
- [x] Verify GLB parses, deforms and supports both hands.

### Task 3: Runtime appearance and load lifecycle
Files: public/js/player.js, public/js/character-slot.js, public/js/screen.js, test/character.test.js.
Interfaces: PlayerView(gltf,{character,accent,shadowTex}), dispose(); CharacterSlot({load,create,attach,detach,onStatus}), select(id), view, dispose().
- [x] Write failing tests for preserving external mesh/material, clear validation, race handling and failed-load fallback.
- [x] Implement per-character appearance and resource-safe replacement. Cache original GLBs, clone owned materials, never dispose shared geometry/textures.
- [x] Connect two slots to authoritative state; preserve keyboard controls and training.
- [x] Verify existing rig tests and both rabbit rigs.

### Task 4: Comparison experience and delivery
Files: public/characters.html, public/css/characters.css, public/js/character-demo.js, docs/character-system-usage.md.
- [x] Build responsive warm studio page with matched A/B cameras and lighting, synchronized idle / footwork / clear / smash, left/right hand, front/side/back, speed and pause.
- [x] Link each demo to game selection, link game back to comparison, show loading/fallback and provenance clearly.
- [x] Run full npm test, browser console/network checks, desktop/mobile interaction and screenshots.
- [x] Independent code review, fix substantive findings, document entry URLs and remaining asset limitations.

## Progress
- Ruling: reuse the dirty working checkout because it contains the actual approved baseline; no branch changes, reset or unrelated commits.
- Ruling: compare locally authored geometric and skinned rabbits; no paid external generation credentials are available or needed for a working comparison.

- Task 1 complete: three network regression tests RED→GREEN; phone/screen sync and refresh verified in real browser pages.
- Task 2 complete: independent asset implementation,9 asset tests; both variants/both hands contact and skeleton/weights checks pass.
- Task 3 complete: lifecycle and material/validation tests RED→GREEN; source resources survive disposal.
- Task 4 complete: desktop/mobile live comparison,74/74 Node tests, browser regressions and page interactions pass.
- Review: independent reviewer found three P2 demo issues (bfcache, pause pose, repeated high-DPR resize); each reproduced then fixed in a single pass, browser regression green.
- Ruling: no arbitrary external skeleton retargeting, unique IP assets, mobile LOD or facial/ear animation in this first rabbit implementation. Retain the documented import contract; expansion needs asset work.
- Deferred polish: base idle/run clip phases can differ slightly due to asynchronous asset arrivals; procedure-driven strokes share time.
