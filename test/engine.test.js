// Tests for the pure game engine: determinism and the three modes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, level, inPractice, currentConfig } from '../engine/game.js';
import { modeConfig, NORMAL_GAP, NORMAL_SPEED, PRACTICE_MS } from '../engine/config.js';
import { MODES, DT } from '../engine/constants.js';

// Play a game with a fixed tap pattern (tap every 20th frame) for n frames.
function playFixed(mode, seed, n = 600, runIndex = 0) {
  const g = createGame({ mode, seed, runIndex });
  for (let f = 0; f < n && !g.over; f++) step(g, { flap: f % 20 === 0 });
  return g;
}

test('same seed + same inputs -> exactly the same game', () => {
  for (const mode of MODES) {
    assert.deepEqual(playFixed(mode, 7), playFixed(mode, 7));
  }
});

test('different seeds -> different wall layouts', () => {
  const a = createGame({ seed: 1 }), b = createGame({ seed: 2 });
  for (let f = 0; f < 200; f++) { step(a, {}); step(b, {}); }
  assert.notEqual(a.walls[0].gapY, b.walls[0].gapY);
});

test('normal is full difficulty from wall 1', () => {
  for (let w = 0; w < 30; w++) {
    assert.deepEqual(modeConfig('normal', w, w * 1000), { gap: NORMAL_GAP, speed: NORMAL_SPEED, ghost: false });
  }
});

test('gentle_ramp: wider and slower at first, normal from wall 10', () => {
  const first = modeConfig('gentle_ramp', 0, 0);
  assert.ok(first.gap > NORMAL_GAP && first.speed < NORMAL_SPEED);
  // Gap gets smaller wall by wall during Level 1.
  for (let w = 1; w < 10; w++) assert.ok(modeConfig('gentle_ramp', w, 0).gap < modeConfig('gentle_ramp', w - 1, 0).gap);
  assert.deepEqual(modeConfig('gentle_ramp', 10, 0), modeConfig('normal', 10, 0));
});

test('variants only change the first try: every retry is the normal game', () => {
  for (const mode of MODES) {
    const retry = createGame({ mode, seed: 1, runIndex: 1 });
    assert.deepEqual(currentConfig(retry, 0), modeConfig('normal', 0, 0));
  }
  assert.notDeepEqual(currentConfig(createGame({ mode: 'gentle_ramp', runIndex: 0 }), 0), modeConfig('normal', 0, 0));
});

test('practice_first: harmless ghost walls for 10 s on the first try only', () => {
  assert.equal(modeConfig('practice_first', 0, 0).ghost, true);
  assert.equal(modeConfig('practice_first', 0, PRACTICE_MS).ghost, false);
  // Doing nothing at all: normal crashes on the floor, practice keeps you alive.
  const idleNormal = createGame({ mode: 'normal', seed: 3 });
  const idlePractice = createGame({ mode: 'practice_first', seed: 3 });
  for (let f = 0; f < 300; f++) { step(idleNormal, {}); step(idlePractice, {}); }
  assert.equal(idleNormal.over, true);
  assert.equal(idlePractice.over, false);
  assert.equal(inPractice(idlePractice), true);
  // Second try in the session: no practice zone.
  assert.equal(inPractice(createGame({ mode: 'practice_first', runIndex: 1 })), false);
  // Ghost walls never score.
  const g = playFixed('practice_first', 3, Math.floor((PRACTICE_MS - 500) / DT));
  assert.equal(g.wallsPassed, 0);
});

test('level goes 1 -> 2 -> 3 at 10 and 20 walls', () => {
  const g = createGame();
  assert.equal(level(g), 1);
  g.wallsPassed = 10; assert.equal(level(g), 2);
  g.wallsPassed = 20; assert.equal(level(g), 3);
});
