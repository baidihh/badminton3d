# Badminton contact implementation plan

**Goal** Keep automatic footwork and deliver repeatable net shots and forward smashes with spatially distinct poses and outcomes.

**Architecture** Share an animation-relative racket pose between the server and the Three.js player. Plan constrained net or overhead contact, sweep the moving string bed against the cork, then apply a racket-directed launch and integrate the shuttle. Feed lab scenarios through isolated game instances.

- [x] Add regressions for cross-court vs straight net shots, unreachable contact, and forward/downward smash.
- [x] Implement shared racket profile, bounded contact planning, sweep and launch. Add net approach and overhead positioning, controls, and shared animation input.
- [x] Add fixed feed previews with three positions, selectable timing, freeze/scrub, and the contact/net/landing event data from the same game rules.
- [x] Run game/rig regressions and verify the lab and normal game entry in a browser.

Rollout starts with net shots and smashes. Legacy high clear, rear drop and serve retain their existing launch logic during this iteration. Keep the current checkout and avoid commits mixing existing edits.

Verification covered 129 Node tests, six scripted feeds, nine avatar rigs at the demonstrated contact frames, and Chrome checks for WebGL replay, manual timing, mobile layout and match entry. The local preview uses 3102 because 3101 has a connected controller.
