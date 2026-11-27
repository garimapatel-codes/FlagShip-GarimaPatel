// The human-playable game. Same engine as the robots; Flagsmith decides Level 1.
import { createGame, step } from '../../engine/game.js';
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
let bestBefore = 0;        // best score before this try (drawing only: shows "NEW BEST!")

// ---- Crisp pixels on every screen: match the canvas to its on-screen size ----
// The canvas keeps the game's 2:3 shape; drawGame scales the 400 x 600 world to fit.
function fitCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * ratio); // on-screen width (without the border) in real pixels
  if (w > 0 && canvas.width !== w) { canvas.width = w; canvas.height = Math.round(w * 1.5); }
}
window.addEventListener('resize', fitCanvas);

// ---- Start-up: ask Flagsmith which Level 1 this player gets ----
async function start() {
  await initFlags(getOrCreatePlayerId()); // never throws; offline if no key
  mode = getLevelMode();                  // records the exposure when online
  $('offline').hidden = isOnline();
  // ?debug in the address bar shows which Level 1 this player got (for demos only).
  // It shows a coloured diamond instead of the version name, so a player looking over
  // your shoulder learns nothing:  blue = normal, green = gentle_ramp, purple = practice_first.
  if (new URLSearchParams(location.search).has('debug')) {
    const DIAMOND_COLOURS = { normal: '#2f6fdb', gentle_ramp: '#1f9d55', practice_first: '#8a3fd1' };
    $('mode').textContent = '\u2666'; // the ♦ character
    $('mode').style.color = DIAMOND_COLOURS[mode] || '#2a1a1f';
    $('mode').hidden = false;
  }
  game = createGame({ mode, seed: Date.now() % 1e9, runIndex });
  requestAnimationFrame(loop);
}

// ---- Input: one handler for keyboard, mouse and touch ----
function tap(e) {
  if (e) e.preventDefault();
  if (phase === 'ready') { phase = 'playing'; $('message').textContent = 'Tap, click or press Space to fly up'; }
  if (phase === 'playing') { flapQueued = true; return; }
  if (phase === 'over' && performance.now() - overAt > 400) {
    runIndex += 1; // a retry is a new run in the same session
    bestBefore = best;
    game = createGame({ mode, seed: Date.now() % 1e9, runIndex });
    phase = 'playing';
    flapQueued = true;
    $('message').textContent = 'Tap, click or press Space to fly up';
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
      $('message').textContent = `Kite down after ${game.wallsPassed} walls. Tap to try again`;
    }
  }
  fitCanvas();
  drawGame(ctx, game, {
    t: now / DT, // animation clock: keeps clouds and the tail moving on every screen
    ui: { phase, best, newBest: phase === 'over' && best > bestBefore, canRetry: now - overAt > 400 },
  });
  canvas.dataset.phase = phase;             // handy for screenshots and tests
  canvas.dataset.score = game.wallsPassed;
  requestAnimationFrame(loop);
}

start();
