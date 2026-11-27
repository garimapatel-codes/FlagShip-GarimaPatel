// Flagsmith adapter for the robot players (Node.js).
//
// The simulator only ever calls three things:
//   getLevelMode(botId)          -> which Level 1 the bot plays ('normal' | 'gentle_ramp' | 'practice_first')
//   track(botId, eventName, val) -> send one event (a conversion) for that bot
//   close()                      -> send every event still waiting in the buffer, then stop
//
// Two ways to run it:
//   REAL    (dryRun: false) talks to Flagsmith with @flagsmith/nodejs. Needs FLAGSMITH_SERVER_KEY.
//   DRY RUN (dryRun: true)  no network at all. A stable hash of the bot id picks the arm, and
//                           events are kept in memory in client.events, so tests can look at them.
//
// Golden rule: Flagsmith problems must never crash the simulation. Any error -> the bot gets
// 'normal', we print one warning per kind of problem, and we count it in client.stats.fallbacks so the summary
// can show it (a run full of fallbacks is not a valid experiment).
//
// The secret key is read from process.env and is never printed.

import { readFileSync, existsSync } from 'node:fs';
import { FLAG, MODES } from '../engine/constants.js';

// ---------------------------------------------------------------------------
// 1. A tiny .env loader (no dependency needed).
//    Reads lines like  KEY=value  from the .env file in the project root.
//    It never overwrites a variable that is already set, so these two ways both work:
//      node bots/sim.mjs                     (this function reads .env for you)
//      node --env-file=.env bots/sim.mjs     (Node 20.6+ reads it; this function changes nothing)
// ---------------------------------------------------------------------------
export function loadEnv(path = new URL('../.env', import.meta.url)) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue; // skip blanks and comments
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Remove optional surrounding quotes: KEY="abc" -> abc
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// 2. Stable hash -> arm (used by dry run only).
//    FNV-1a turns a string into a 32-bit number; the same id always gives the same number.
//    The extra "mixing" lines spread the bits so that id % 3 is close to an even split.
// ---------------------------------------------------------------------------
export function stableHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // final mix (from MurmurHash3) so similar ids like bot-1, bot-2 land far apart
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0; // make it a positive whole number
}

// In Flagsmith the base value is called 'control'; the other arms are named by their variant key.
const VARIANT_KEYS = ['control', 'gentle_ramp', 'practice_first'];

// Turn whatever the flag returned into a safe mode string.
function toMode(value) {
  return MODES.includes(value) ? value : null;
}

// ---------------------------------------------------------------------------
// 3. The factory the simulator calls.
//    options:
//      dryRun  true = offline, no Flagsmith
//      runTag  label of this run (only used in messages)
//      aa      true = A/A check. Talks to the separate A/A environment (key FLAGSMITH_SERVER_KEY_AA),
//              records exposures exactly as normal, but EVERY bot plays 'normal' whatever arm it
//              is in. If the pipeline is fair, the three arms must then look the same.
//      flag    which flag to read. Default 'level1_mode' (or env FLAGSMITH_FLAG).
// ---------------------------------------------------------------------------
export async function createFlagClient({ dryRun = false, runTag = 'run', aa = false, flag } = {}) {
  loadEnv();
  const flagName = flag || process.env.FLAGSMITH_FLAG || FLAG;
  const isAA = aa;

  // Numbers the simulator can print in its summary.
  const stats = { exposures: 0, events: 0, fallbacks: 0 };
  // botId -> variant key ('control', 'gentle_ramp', ...). Lets the sim group bots per arm,
  // which matters in the A/A run where every arm plays 'normal'.
  const variants = new Map();

  // Print each KIND of problem once, so 600 bots don't flood the screen.
  const warned = new Set();
  function warnOnce(kind, message) {
    if (warned.has(kind)) return;
    warned.add(kind);
    console.warn(`[flags] WARNING (${runTag}): ${message}. (Shown once.)`);
  }

  // ---------------- DRY RUN ----------------
  if (dryRun) {
    const events = []; // every event, in order: { event, identifier, value }
    return {
      online: false,
      flagName,
      events,
      stats,
      variantOf: (botId) => variants.get(botId),
      async getLevelMode(botId) {
        const variant = VARIANT_KEYS[stableHash(`${flagName}:${botId}`) % 3];
        variants.set(botId, variant);
        // A/A: three arms, but they all play the normal game.
        const mode = isAA ? 'normal' : (variant === 'control' ? 'normal' : variant);
        // Pretend to record an exposure, like the real SDK does.
        events.push({ event: '$flag_exposure', identifier: botId, value: variant });
        stats.exposures++;
        return mode;
      },
      track(botId, eventName, value) {
        events.push({ event: eventName, identifier: botId, value: value ?? null });
        stats.events++;
      },
      async close() {},
    };
  }

  // ---------------- REAL FLAGSMITH ----------------
  // The A/A run uses its OWN environment, so its data never mixes with the real experiment.
  const keyName = isAA ? 'FLAGSMITH_SERVER_KEY_AA' : 'FLAGSMITH_SERVER_KEY';
  const key = process.env[keyName];
  let flagsmith = null;
  if (!key) {
    warnOnce('nokey', `${keyName} is not set (copy .env.example to .env). Every bot plays 'normal' and counts as a fallback`);
  } else {
    try {
      // Loaded only here, so dry runs work even before `npm install`.
      const { Flagsmith } = await import('@flagsmith/nodejs');
      flagsmith = new Flagsmith({
        environmentKey: key,
        enableEvents: true, // REQUIRED: without it getExperimentFlag and trackEvent throw
        eventProcessorConfig: {
          maxBuffer: 5000,      // hold up to 5000 events (default 1000 can drop the oldest when bots are fast)
          flushInterval: 2000,  // send a batch every 2 s instead of every 10 s
        },
      });
    } catch (err) {
      warnOnce('init', `could not start the Flagsmith SDK (${err.message})`);
      flagsmith = null;
    }
  }

  let sinceFlush = 0; // events tracked since our last manual flush
  function maybeFlush() {
    // Send a batch every 500 events so the buffer never fills up during a big run.
    // flushEvents() never rejects; we don't wait for it here.
    if (++sinceFlush >= 500) {
      sinceFlush = 0;
      flagsmith.flushEvents();
    }
  }

  return {
    online: !!flagsmith,
    flagName,
    events: null, // real mode does not keep a copy
    stats,
    variantOf: (botId) => variants.get(botId),

    async getLevelMode(botId) {
      if (!flagsmith) { stats.fallbacks++; return 'normal'; }
      try {
        // One call = evaluate the flag for this identity AND record the exposure
        // (only if the identity is enrolled in a running experiment).
        const result = await flagsmith.getExperimentFlag(flagName, botId);
        if (!result.enabled) {
          // A disabled flag records no exposure, so treat it as "no experiment": play normal.
          warnOnce('disabled', `flag "${flagName}" is disabled or missing in this environment; using 'normal'`);
          stats.fallbacks++;
          return 'normal';
        }
        const mode = toMode(result.value);
        if (!mode) {
          warnOnce('badvalue', `flag "${flagName}" returned ${JSON.stringify(result.value)}, which is not one of ${MODES.join(', ')}; using 'normal'`);
          stats.fallbacks++;
          return 'normal';
        }
        if (!result.experiment?.inExperiment) {
          // Not an error, but no exposure was recorded: is the experiment started?
          warnOnce('notenrolled', `"${botId}" is not enrolled in a running experiment on "${flagName}" (no exposure recorded). Has the experiment been started?`);
        } else {
          stats.exposures++;
        }
        variants.set(botId, result.variant ?? 'control');
        return isAA ? 'normal' : mode; // A/A: exposure recorded for the real arm, gameplay forced to normal
      } catch (err) {
        warnOnce('get', `getExperimentFlag failed (${err.message}); using 'normal'`);
        stats.fallbacks++;
        return 'normal';
      }
    },

    track(botId, eventName, value) {
      if (!flagsmith) return;
      try {
        // The identifier MUST be the same one used in getLevelMode, or the event
        // cannot be joined to the exposure. value is optional (numbers are fine; the SDK sends them as text).
        flagsmith.trackEvent(eventName, value === undefined ? { identifier: botId } : { identifier: botId, value });
        stats.events++;
        maybeFlush();
      } catch (err) {
        warnOnce('track', `trackEvent failed (${err.message})`);
      }
    },

    async close() {
      if (!flagsmith) return;
      try {
        // Sends everything still buffered. Wait at most 30 s, then give up.
        await flagsmith.close(30000);
      } catch (err) {
        warnOnce('close', `close failed (${err.message})`);
      }
    },
  };
}
