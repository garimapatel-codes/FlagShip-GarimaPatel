// The human-playable game. Same engine as the robots; Flagsmith decides Level 1.
import { createGame, step, level } from '../../engine/game.js';
import { DT, EVENTS, LEVEL_3_AT } from '../../engine/constants.js';
import { initFlags, getLevelMode, track, flush, isOnline, getOrCreatePlayerId } from './flags.js';
import { drawGame } from './draw.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

// ---- Session state (one page visit = one session) ----
let mode = 'normal';
let runIndex = 0;          // how many tries so far
let game = null;           // the current run
let phase = 'ready';       // 'ready' -> 'playing' -> 'over' -> (tap) 'playing' ...
let best = 0;              // best walls in one run this session
let reachedL3 = false;     // send reached_level_3 only once
let wallsSent = false;     // send walls_passed only once
let flapQueued = false;    // a tap waiting for the next physics step
let overAt = 0;            // time of the last crash (to ignore panic taps)

// ---- Start-up: ask Flagsmith which Level 1 this player gets ----
async function start() {
  await initFlags(getOrCreatePlayerId()); // never throws; offline if no key
  mode = getLevelMode();                  // records the exposure when online
  $('offline').hidden = isOnline();
  // ?debug in the address bar shows which Level 1 this player got (for demos only).
  if (new URLSearchParams(location.search).has('debug')) {
    $('mode').textContent = `mode: ${mode}`;
    $('mode').hidden = false;
  }
  game = createGame({ mode, seed: Date.now() % 1e9, runIndex });
  requestAnimationFrame(loop);
}

// ---- Input: one handler for keyboard, mouse and touch ----
function tap(e) {
  if (e) e.preventDefault();
  if (phase === 'ready') { phase = 'playing'; $('message').textContent = ''; }
  if (phase === 'playing') { flapQueued = true; return; }
  if (phase === 'over' && performance.now() - overAt > 400) {
    runIndex += 1; // a retry is a new run in the same session
    game = createGame({ mode, seed: Date.now() % 1e9, runIndex });
    phase = 'playing';
    flapQueued = true;
    $('message').textContent = '';
  }
}
window.addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'ArrowUp') tap(e); });
canvas.addEventListener('pointerdown', tap);

// ---- Send walls_passed once, when the player leaves the page ----
function endSession() {
  if (wallsSent) return;
  wallsSent = true;
  track(EVENTS.WALLS_PASSED, best);
  flush();
}
window.addEventListener('pagehide', endSession);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') endSession(); });

// ---- Main loop: fixed physics steps, draw once per screen refresh ----
let last = performance.now(), acc = 0;
function loop(now) {
  acc += Math.min(now - last, 250); // cap so a background tab doesn't run 1000 steps
  last = now;
  while (acc >= DT) {
    acc -= DT;
    if (phase !== 'playing') continue;
    step(game, { flap: flapQueued });
    flapQueued = false;
    best = Math.max(best, game.wallsPassed);
    if (!reachedL3 && game.wallsPassed >= LEVEL_3_AT) {
      reachedL3 = true;
      track(EVENTS.REACHED_LEVEL_3);
      flush();
    }
    if (game.over) {
      phase = 'over';
      overAt = performance.now();
      $('message').textContent = `Crashed after ${game.wallsPassed} walls. Tap to try again`;
    }
  }
  drawGame(ctx, game);
  $('level').textContent = level(game);
  $('walls').textContent = game.wallsPassed;
  $('best').textContent = best;
  requestAnimationFrame(loop);
}

start();
