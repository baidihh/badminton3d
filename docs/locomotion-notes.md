# Contact-based footwork solver

`public/js/locomotion.js` exports the pure numeric `ContactLocomotion` class and has no Three.js dependency. Each player owns one instance. `update(dt, input)` returns independent pose snapshots, so retaining a previous result for comparison is safe.

Input fields are world-space authoritative visual root `x/z`, velocity `vx/vz`, body `yaw` in radians (0 faces +Z; π faces −Z), racket `hand`, numeric low-ball `near` strength 0–1, world `ballX/ballZ`, optional original two-bone `legReach`, and opponent `opponentImpactId/opponentImpactAge` in seconds. Missing numeric fields receive finite defaults. The first update and large root jumps reset feet around the new root instead of dragging old contacts across the court.

Returned pose:

- `feet.left/right`: world `x/z`, swing-only `lift`, independent world `yaw`, heel/toe `pitch` in radians, `stance` and normalized swing `phase` (1 when grounded). During a split-step hop both public stance flags are false, but per-foot lift remains zero; `splitHeight` represents the common lift separately.
- `pelvis`: bounded world offsets `x/z`, positive downward `drop`, and body-local `roll/pitch` in radians. This drives the hip bone separately from the authoritative root.
- `splitHeight`: common upward displacement that the renderer applies to the body and both ankle targets.

Grounded X/Z targets never interpolate toward the moving body. At toe-off, the solver predicts a single landing from current root/velocity, neutral stance width and stride timing. This target remains frozen throughout the swing. A smooth travel curve, sinusoidal ankle clearance and independent toe-off/heel-contact pitch move the swinging foot; the opposite foot stays planted. Touchdown completes before the next liftoff. At ordinary walk/run speeds there is always a planted foot, with no unintended two-foot flight.

Stance width scales with leg reach and stays within ±0.12–0.16 m per foot. Stretch release uses a conservative horizontal budget of approximately `legReach * 0.64`; if support approaches that limit, the frozen touchdown is brought forward in time rather than retargeting its position or sliding the support. The renderer still owns actual ankle height, knee pole and two-bone safety limits, including an appropriate ready/running crouch. The gait adds small hip drop, support-side weight shift, acceleration lean and landing softness. Ordinary horizontal weight shift is capped at 0.087 m; low-ball lunges permit up to 0.105 m. Output angles and shifts damp smoothly through starts, stops and reversals.

For a stationary or slowly moving player, a sufficiently strong low-ball cue places the racket-side foot toward the ball, adds a modest drop and forward load, and holds the lunge without continually chasing ball coordinates. Behind-body cues do not create backward lunges. The foot recovers through normal single-foot steps when the cue disappears or movement resumes. Both racket hands and both world-facing directions use the same solver.

A new opponent impact ID is consumed once. Its initial supplied age places the split-step directly in the appropriate preload/hop/landing phase; later repeated snapshots cannot restart it. The hop peaks near 0.118 s after the impact and is about 0.057 m high. Cues older than 0.26 s are ignored. The solver does not infer hits from ball/net recrossings. Split hopping waits for a grounded interval and is omitted during fast movement above 1.4 m/s, preserving moving contacts. The last 64 impact IDs are remembered. A common hop is the only deliberate two-foot airborne case.

Time advances in substeps no larger than 1/120 s, with root position interpolated across the incoming frame. Normal 30/60/120 Hz paths therefore produce matching contact trajectories and timing. A single delayed update is bounded to 0.1 s; the solver is intended for continuously sampled visual state, not replaying long offline time gaps.

Validation at handoff:

- `node --test test/locomotion.test.js`: 11/11 pass. Tests cover exact stance immobility, alternating walk/run contacts without double flight, fixed mid-swing destinations despite changing velocity, impact IDs/late ages/recrossings, stopping without endless steps, both-hand lunges/recovery, teleports, independent stance yaw, 30/60/120 Hz consistency, shorter-leg stretch release and multiple direction changes.
- The initial tests failed for the missing implementation before code was added. The shorter-leg reach regression failed before tightening the stretch release budget.
- Fresh `npm test`: 121/121 pass, including parent rig integration.
- `tools/motion-audit.mjs` run against the current integrated PlayerView showed 0 unintended two-foot-air frames at all three frame rates and idle/walk/run speeds. At 60 Hz, actual rig ankle maximum planted-frame X/Z movement was approximately 0.000059 mm at 1.6 m/s and 0.000096 mm at 3.6 m/s, consistent with floating-point pose reconstruction. Numeric planner stance X/Z movement is exactly zero.
- In a separate 10 s straight-path planner sweep with 0.9 m leg reach, maximum horizontal stance distance was about 0.503 m walking and 0.593 m running. With 0.78 m legs it was about 0.498/0.472 m. Cadence is intentionally quick sporting footwork, about 31 walking and 51 running steps per 10 s in those fixtures.

This is a deterministic visual contact/weight-transfer model, not a ground-force simulation or a biomechanically validated motion-capture rig. Final realism still depends on upper-body sequencing, knee poles, foot mesh proportions, camera framing and the parent renderer's hip/ankle integration. No server movement, collision or shot timing is changed by this module.
