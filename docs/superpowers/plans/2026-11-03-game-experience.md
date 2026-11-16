# COURTSIDE complete game experience

User delegates UI and game-flow decisions and asks to integrate the role demos into the actual project with an impressive playable experience.

Approach: retain existing authority/physics/controller/training and give the main route a unified coastal club design. Alternative separate gallery-to-game links leaves setup fragmented; replacing the game engine is unnecessary. Build within existing checkout, no unrelated commits/resets or deployment.

- [x] Lobby flow: welcome → role selection → mode/difficulty/control setup → enter match. Live3D selected-character preview,9 selectable roles, remembered preference, back navigation and keyboard/phone paths.
- [x] Court: sunny mint/coral arena, legible broadcast scoreboard, role portraits, rally and connection feedback, accessible controls and real event-driven result overlay.
- [x] Integration: role selection acknowledged by authoritative snapshot; entry blocked until selected asset ready/network ready. Double play keyboard and optional second phone. Lobby prevents accidental keyboard swings. Training remains available.
- [x] Verification: model flow tests RED→GREEN, Node suite, real browser desktop/mobile main flow+return+rematch+controller, screenshots, independent review.

Constraints: no fabricated statistics, no literal game pause without authoritative server support, no claims of internet deployment. Returning to lobby stops local keyboard input but does not pretend to pause shared match. Score/result derives from server state.

Independent review identified mode continuity, rematch readiness, and pending-selection latch. Added regression tests RED→GREEN and fixed;105/105 Node tests pass. Main browser flow including9roles, rapid choices, dual keyboard, phone readiness, mobile layout andhelp passed. Screenshot captures inspect real WebGL output. No serverpause or fabricatedstats.

Final verification: real keyboard match ended7:6, actual result screenshot saved, rematch returned0:0. Phone/screen bidirectional selection and both refresh recoveries passed without pageerrors. Complete flow replay passed after final UI refinements. Screenshots in docs/game-{home,characters,setup,court,result,controller}.png.
