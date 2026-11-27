// The whole game as pure logic: no drawing, no keyboard, no clock.
// The browser and the robots both call these same functions, so they
// are guaranteed to play exactly the same game.
import { DT, WALLS_PER_LEVEL } from './constants.js';
import { modeConfig } from './config.js';
import { nextRandom } from './rng.js';

// World size and physics, in pixels and "per frame" (1 frame = 1/60 s).
export const WORLD = { W: 400, H: 600 };
export const BIRD_X = 90;        // the character stays at this x; walls move instead
export const BIRD_R = 12;        // the character is a circle of this radius
export const GRAVITY = 0.45;     // downward speed added every frame
export const FLAP_VY = -7.5;     // a flap sets vertical speed to this (upwards)
export const WALL_W = 60;        // wall thickness
export const WALL_SPACING = 230; // horizontal distance between walls
const GAP_MARGIN = 115;          // gap centres stay this far from top/bottom
const MAX_JUMP = 210;            // next gap centre moves at most this far from the last

// Start a new run. runIndex = which try this is in the session (0 = first).
export function createGame({ mode = 'normal', seed = 1, runIndex = 0 } = {}) {
  return {
    mode, runIndex,
    rngState: seed | 0,        // random state lives in the game state -> fully reproducible
    timeMs: 0, frame: 0,
    y: WORLD.H / 2, vy: 0,     // character height (0 = top) and vertical speed
    walls: [],                 // walls currently on screen
    nextWallIndex: 0,          // index the next *real* (non-practice) wall will get
    lastGapY: WORLD.H / 2,
    wallsPassed: 0,
    lastPass: null,            // info about the wall passed this frame, if any
    over: false,
  };
}

// Pick a random number in [lo, hi) using the game's own random state.
function rand(state, lo, hi) {
  const [r, next] = nextRandom(state.rngState);
  state.rngState = next;
  return lo + r * (hi - lo);
}

// The difficulty right now. Both variants only change the FIRST try of a session
// (same "dose" for gentle_ramp and practice_first); every retry is the normal game.
export function currentConfig(state, wallIndex) {
  const mode = state.runIndex === 0 ? state.mode : 'normal';
  return modeConfig(mode, wallIndex, state.timeMs);
}

// Add a wall at the right edge of the screen.
function spawnWall(state, x) {
  const ghost = currentConfig(state, state.nextWallIndex).ghost;
  // Real walls get the next index; ghost walls don't count, so they get -1.
  const index = ghost ? -1 : state.nextWallIndex++;
  const cfg = currentConfig(state, Math.max(index, 0));
  const lo = Math.max(GAP_MARGIN, state.lastGapY - MAX_JUMP);
  const hi = Math.min(WORLD.H - GAP_MARGIN, state.lastGapY + MAX_JUMP);
  const gapY = rand(state, lo, hi);
  state.lastGapY = gapY;
  state.walls.push({ x, gapY, gap: cfg.gap, ghost, index, minClear: Infinity });
}

// Advance the game by one fixed timestep. input.flap = true means "tap now".
// The state object is updated in place and also returned for convenience.
export function step(state, input = {}, dtMs = DT) {
  if (state.over) return state;
  const k = dtMs / DT;                 // 1 when called with the normal timestep
  state.lastPass = null;
  const practice = currentConfig(state, 0).ghost;

  // 1. Character physics: a flap sets speed upward, gravity pulls down.
  if (input.flap) state.vy = FLAP_VY;
  state.vy += GRAVITY * k;
  state.y += state.vy * k;

  // 2. Walls slide left at the current speed (based on the next wall to pass).
  const speed = currentConfig(state, state.wallsPassed).speed;
  for (const w of state.walls) w.x -= speed * k;

  // 3. Spawn a new wall when the last one has moved far enough in.
  const last = state.walls[state.walls.length - 1];
  if (!last) spawnWall(state, WORLD.W + 60);
  else if (last.x < WORLD.W - WALL_SPACING) spawnWall(state, last.x + WALL_SPACING);

  // 4. Floor and ceiling: deadly, except in the practice zone where you just bounce.
  if (state.y + BIRD_R > WORLD.H || state.y - BIRD_R < 0) {
    if (practice) {
      state.y = Math.min(Math.max(state.y, BIRD_R), WORLD.H - BIRD_R);
      state.vy = 0;
    } else state.over = true;
  }

  // 5. Walls: crash if overlapping the solid part; score when fully passed.
  for (const w of state.walls) {
    const overlapsX = BIRD_X + BIRD_R > w.x && BIRD_X - BIRD_R < w.x + WALL_W;
    if (overlapsX && !w.ghost) {
      const top = w.gapY - w.gap / 2, bottom = w.gapY + w.gap / 2;
      // Clearance = how many pixels were left between the character and the wall.
      const clear = Math.min(state.y - BIRD_R - top, bottom - (state.y + BIRD_R));
      w.minClear = Math.min(w.minClear, clear);
      if (clear < 0) state.over = true;
    }
    if (!w.done && w.x + WALL_W < BIRD_X - BIRD_R) {
      w.done = true;
      if (!w.ghost) {
        state.wallsPassed += 1;
        state.lastPass = { clearance: w.minClear };
      }
    }
  }
  // Forget walls that have left the screen.
  state.walls = state.walls.filter((w) => w.x + WALL_W > -10);

  state.timeMs += dtMs;
  state.frame += 1;
  return state;
}

export function isOver(state) {
  return state.over;
}

// Level 1 = walls 0-9 passed, Level 2 = 10-19, Level 3 = 20 or more.
export function level(state) {
  return Math.min(3, 1 + Math.floor(state.wallsPassed / WALLS_PER_LEVEL));
}

// True while the first-run practice zone is active (used for the "Practice" label).
export function inPractice(state) {
  return currentConfig(state, 0).ghost;
}

// The next wall the character still has to get through (or null).
export function nextWall(state) {
  return state.walls.find((w) => !w.done && w.x + WALL_W >= BIRD_X - BIRD_R) || null;
}

// ---- What a player can see, and the only way a robot touches the game ----

// A fresh plain object with only on-screen facts (no mode, no try number, no ghost flag).
export function observe(game) {
  const w = nextWall(game);
  return {
    y: game.y, vy: game.vy,               // character height and vertical speed
    gapY: w ? w.gapY : game.y,            // centre of the next opening
    gap: w ? w.gap : 0,                   // size of the next opening
    wallsPassed: game.wallsPassed,        // the score shown on screen
    over: game.over,                      // did we just crash?
    frame: game.frame,                    // how many frames this try has lasted
    // Room left between the character and the wall it just passed (or null).
    clearance: game.lastPass ? game.lastPass.clearance : null,
  };
}

// A "screen + button" for one try: look() returns what is on screen, tap(flap) advances one frame.
export function makeScreen(game) {
  return {
    look: () => observe(game),
    tap: (flap) => { step(game, { flap }); },
  };
}
