// How hard the game is at any moment, for each Level 1 mode.
// modeConfig(mode, wallIndex, timeMs) -> { gap, speed, ghost }
//   wallIndex: which wall we are talking about (0 = the very first wall)
//   timeMs:    how long this run has been going
//   gap:       height of the opening in the wall, in pixels
//   speed:     how fast walls slide left, in pixels per frame
//   ghost:     true = walls are harmless "practice" walls
// Note: game.js only uses the variant on the first try of a session.

export const NORMAL_GAP = 140;     // full-difficulty opening height (px)
export const NORMAL_SPEED = 2.8;   // full-difficulty wall speed (px per frame)
export const RAMP_WALLS = 10;      // gentle_ramp eases back to normal over Level 1
export const PRACTICE_MS = 10000;  // practice_first: 10 seconds of ghost walls

export function modeConfig(mode, wallIndex, timeMs) {
  // Start from full difficulty; only Level 1 of the variants changes it.
  const cfg = { gap: NORMAL_GAP, speed: NORMAL_SPEED, ghost: false };

  if (mode === 'gentle_ramp' && wallIndex < RAMP_WALLS) {
    // t goes 0, 0.1, ... 0.9 across the first 10 walls: wall 1 is easiest,
    // wall 10 is almost normal, and wall 11 onwards is fully normal.
    const t = wallIndex / RAMP_WALLS;
    cfg.gap = NORMAL_GAP * (1.5 - 0.5 * t);     // 210px wide at first, shrinking towards 140
    cfg.speed = NORMAL_SPEED * (0.7 + 0.3 * t); // 70% speed at first, 97% by wall 10, 100% after
  }

  if (mode === 'practice_first' && timeMs < PRACTICE_MS) {
    cfg.ghost = true; // walls pass through you and do not score
  }

  return cfg;
}
