// The robot player's "brain".
// IMPORTANT: this file never sees which Level 1 version the bot got.
// It is handed a "screen" for each try: screen.look() returns only what a human
// sees (height, speed, next gap, score, crash), and screen.tap(flap) moves one frame.
import { GRAVITY, BIRD_R } from '../engine/game.js';
import { DT, LEVEL_3_AT, MAX_RUNS } from '../engine/constants.js';
import { makeRng, hashSeed } from '../engine/rng.js';

// ---- Tuning knobs for how robots behave (the same for every variant) ----
export const BRAIN = {
  NOVICE_EXTRA: 2.5,  // a brand-new player aims (1 + this) times worse...
  LEARN_SEC: 15,      // ...and that extra shrinks ~63% per 15 s played (learning)
  FAST_CRASH_WALLS: 3,// crashing before passing this many walls = a "fast crash"
  EASY_BASE: 0,       // a wall feels easy when the room left is more than
  EASY_PER_NOISE: 1.3,//   EASY_BASE + EASY_PER_NOISE * aimNoise px (skilled = small aimNoise)...
  BORING_SPAN: 30,    // ...and fully boring this many px beyond that
  BORED_MEMORY: 0.8,  // how slowly the boredom meter forgets (0..1)
  MAX_FRAMES: 6000,   // safety stop for one try (100 s)
};

// Bell-curve random number (mean 0, spread 1), made from two uniform randoms.
function gauss(rng) {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Draw one bot's personality from fixed distributions. Only the seed, the bot
// number and the population settings matter, never the variant.
// pop.aimScale < 1 = a more skilled crowd; pop.patienceDelta < 0 = a less patient crowd.
export function makeTraits(seed, n, pop = {}) {
  const { aimScale = 1, patienceDelta = 0 } = pop;
  const rng = makeRng(hashSeed(seed, 'traits', n));
  return {
    reactionMs: Math.round(clamp(230 + 60 * gauss(rng), 120, 420)),            // how late it reacts
    aimNoise: +clamp(aimScale * 14 * Math.exp(0.55 * gauss(rng)), 3, 60).toFixed(1), // how imprecise (px)
    patience: Math.max(0, 1 + Math.floor(rng() * 5) + patienceDelta),             // fast crashes tolerated
    boredomThreshold: +(0.35 + 0.6 * Math.sqrt(rng())).toFixed(2),                // easy play tolerated (0.35..0.95)
  };
}

// Make a controller for one try. It returns decide(view, frame) -> flap?
// mind = things the bot remembers across tries (experience).
function makeController(traits, mind, rng) {
  const delay = Math.max(1, Math.round(traits.reactionMs / DT)); // reaction in frames
  const seen = [];          // past views (we act on an old one = reaction delay)
  let lastFlap = -999;      // frame of our last flap
  let lastGapY = null;      // which gap we are currently aiming at
  let offset = 0;           // this wall's aiming error

  return function decide(view, frame) {
    seen.push(view);
    // The brain only "sees" the world as it was `delay` frames ago.
    const o = seen[Math.max(0, seen.length - 1 - delay)];

    // New wall noticed -> pick a fresh aiming error. Beginners aim worse.
    if (o.gapY !== lastGapY) {
      lastGapY = o.gapY;
      const skill = traits.aimNoise * (1 + BRAIN.NOVICE_EXTRA * Math.exp(-mind.playedSec / BRAIN.LEARN_SEC));
      offset = gauss(rng) * skill;
    }

    // After tapping, wait to see the effect before tapping again (like a human).
    if (frame - lastFlap <= delay) return false;

    // Guess where we are now: move the old view forward with gravity.
    const t = delay;
    const guessY = o.y + o.vy * t + 0.5 * GRAVITY * t * t;
    // Tap when we would sink below a point a little under the gap's centre.
    const trigger = o.gapY + Math.min(25, o.gap / 2 - BIRD_R - 10) + offset;
    if (guessY > trigger) { lastFlap = frame; return true; }
    return false;
  };
}

// How "easy" one passed wall felt (0..1). Skill-relative: a precise player
// needs less room to feel safe, so the same wall bores them sooner.
function easiness(clearance, traits) {
  const easyFrom = BRAIN.EASY_BASE + BRAIN.EASY_PER_NOISE * traits.aimNoise;
  return clamp((clearance - easyFrom) / BRAIN.BORING_SPAN, 0, 1);
}

// Play one whole session: retry until Level 3, a quit, or the 25-try cap.
// newScreen(tryIndex) is given by the caller; the brain never knows the mode.
export function playSession(traits, seed, newScreen) {
  const rng = makeRng(hashSeed(seed, 'brain'));
  const mind = { playedSec: 0, bored: 0, fastCrashes: 0 };
  const runs = [];          // compact replay: flap frames + how each try ended
  let best = 0, outcome = 'cap';

  for (let r = 0; r < MAX_RUNS && outcome === 'cap'; r++) {
    const screen = newScreen(r);
    const decide = makeController(traits, mind, rng);
    const flaps = [];
    let end = 'crash';
    let view = screen.look();

    for (let f = 0; f < BRAIN.MAX_FRAMES && !view.over; f++) {
      const flap = decide(view, f);
      if (flap) flaps.push(f);
      screen.tap(flap);
      view = screen.look();
      mind.playedSec += DT / 1000; // every second played (practice too) teaches you

      // Boredom meter: a slow average of how easy each passed wall felt.
      if (view.clearance !== null) {
        mind.bored = BRAIN.BORED_MEMORY * mind.bored + (1 - BRAIN.BORED_MEMORY) * easiness(view.clearance, traits);
        if (mind.bored > traits.boredomThreshold) { end = 'bored'; break; }
      }
      if (view.wallsPassed >= LEVEL_3_AT) { end = 'level3'; break; }
    }

    best = Math.max(best, view.wallsPassed);
    runs.push({ flaps, frames: view.frame, walls: view.wallsPassed, end });

    if (end === 'level3') outcome = 'level3';
    else if (end === 'bored') outcome = 'bored';
    else {
      mind.bored *= 0.3; // a crash is exciting, so it calms boredom down a lot
      // Count crashes that came very early in a try, one after another.
      mind.fastCrashes = view.wallsPassed < BRAIN.FAST_CRASH_WALLS ? mind.fastCrashes + 1 : 0;
      if (mind.fastCrashes > traits.patience) outcome = 'rage';
    }
  }
  return { outcome, best, runs, playedSec: Math.round(mind.playedSec) };
}
