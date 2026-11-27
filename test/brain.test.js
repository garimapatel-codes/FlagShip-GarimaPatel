// Tests that the robot brain is "honest": its traits and choices never depend on the variant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeTraits, playSession } from '../bots/brain.js';
import { createGame, makeScreen, observe, step } from '../engine/game.js';
import { MODES } from '../engine/constants.js';

const FORBIDDEN = ['mode', 'runIndex', 'ghost'];

// Wrap an object so that reading a forbidden field throws (walls are wrapped too).
function guard(obj) {
  return new Proxy(obj, {
    get(target, key) {
      if (FORBIDDEN.includes(key)) throw new Error(`brain tried to read "${String(key)}"`);
      const value = target[key];
      if (key === 'walls') return value.map(guard);
      return value;
    },
  });
}

// A screen for the brain where both the game (as seen by observe) and the view are guarded.
// Only look() and tap() exist; touching anything else on the screen throws too.
function guardedScreen(game) {
  const screen = { look: () => guard(observe(guard(game))), tap: (flap) => step(game, { flap }) };
  return new Proxy(screen, {
    get(target, key) {
      if (!(key in target)) throw new Error(`brain tried to use screen.${String(key)}`);
      return target[key];
    },
  });
}

test('brain plays full sessions in every mode without ever reading mode/runIndex/ghost', () => {
  for (const mode of MODES) {
    for (const n of [1, 2, 3, 4, 5]) {
      const traits = makeTraits(42, n);
      const s = playSession(traits, n, (r) => guardedScreen(createGame({ mode, seed: 100 * n + r, runIndex: r })));
      assert.ok(['level3', 'rage', 'bored', 'cap'].includes(s.outcome));
    }
  }
});

test('guarded and normal screens give identical sessions (the guard changes nothing)', () => {
  const traits = makeTraits(42, 9);
  const make = (wrap) => (r) => wrap(createGame({ mode: 'practice_first', seed: 5 + r, runIndex: r }));
  assert.deepEqual(playSession(traits, 3, make(guardedScreen)), playSession(traits, 3, make(makeScreen)));
});

test('brain.js source never mentions the mode, the flag, or a variant name', () => {
  // Strip comments first, then search the code itself.
  const code = readFileSync(new URL('../bots/brain.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const word of ['mode', 'variant', 'level1', 'gentle', 'practice', 'normal', 'ghost', 'runindex', 'createGame', 'step(']) {
    assert.ok(!code.toLowerCase().includes(word.toLowerCase()), `brain.js code contains "${word}"`);
  }
});

test('traits depend only on seed + bot number', () => {
  assert.deepEqual(makeTraits(42, 5), makeTraits(42, 5));
  assert.notDeepEqual(makeTraits(42, 5), makeTraits(42, 6));
  assert.deepEqual(Object.keys(makeTraits(1, 1)).sort(), ['aimNoise', 'boredomThreshold', 'patience', 'reactionMs']);
});

test('what the bot sees contains only on-screen information', () => {
  for (const mode of MODES) {
    const keys = Object.keys(observe(createGame({ mode, seed: 1 }))).sort();
    assert.deepEqual(keys, ['clearance', 'frame', 'gap', 'gapY', 'over', 'vy', 'wallsPassed', 'y']);
  }
});

test('sessions are reproducible and end with a known outcome', () => {
  const traits = makeTraits(42, 3);
  const make = (r) => makeScreen(createGame({ mode: 'normal', seed: 100 + r, runIndex: r }));
  const a = playSession(traits, 1, make), b = playSession(traits, 1, make);
  assert.deepEqual(a, b);
  assert.ok(a.runs.length >= 1 && a.runs.length <= 25);
});
