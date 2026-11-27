// Runs N robot players through the experiment and prints the results.
//   node bots/sim.mjs --dry                  offline, no Flagsmith account needed (4500 bots)
//   node bots/sim.mjs --dry --bots 600       quick on-camera run
//   node bots/sim.mjs                        real run: sends exposures + events to Flagsmith
// Options: --dry  --bots N  --tag NAME  --seed N  --aa  --flag NAME
//          --sample (write web/public/arena-sample.json)  --sensitivity (dry only)
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createFlagClient } from './flags.mjs';
import { makeTraits, playSession } from './brain.js';
import { createGame, makeScreen } from '../engine/game.js';
import { EVENTS, MODES } from '../engine/constants.js';
import { hashSeed } from '../engine/rng.js';

// ---- 1. Read command-line options ----
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const sensitivity = args.includes('--sensitivity');
const dryRun = args.includes('--dry') || sensitivity; // sensitivity never touches Flagsmith
const aa = args.includes('--aa');
const total = Number(opt('bots', 4500)); // ~1,500 per arm: ~77% power for a 10% relative lift, ~97% for 15%
const seed = Number(opt('seed', 42));
// Live runs get a timestamp (e.g. run-live-20261126-1430) so two runs never share bot ids.
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const tag = opt('tag', `${aa ? 'aa' : 'run'}-${dryRun ? `dry-s${seed}` : `live-${stamp}`}`);
const SKILLED_NOISE = 10; // bots aiming better than this (px) count as "skilled"

// ---- 2. One bot: ask Flagsmith for its mode, play, report what happened ----
async function runBot(client, n, pop) {
  const botId = `bot-${tag}-${n}`;
  const traits = makeTraits(seed, n, pop);           // drawn BEFORE we know the mode
  const flagMode = await client.getLevelMode(botId); // records the exposure
  const mode = aa ? 'normal' : flagMode;             // A/A: gameplay is always normal
  const arm = aa ? (client.variantOf?.(botId) ?? flagMode) : mode;
  const botSeed = hashSeed(seed, 'bot', n);

  // The brain only gets a "screen" per try. The mode stays hidden inside the game.
  const newScreen = (runIndex) => makeScreen(createGame({ mode, seed: hashSeed(botSeed, runIndex), runIndex }));
  const s = playSession(traits, botSeed, newScreen);

  // Send the experiment events, exactly once per session.
  if (s.outcome === 'level3') client.track(botId, EVENTS.REACHED_LEVEL_3);
  if (s.outcome === 'rage') client.track(botId, EVENTS.RAGE_QUIT);
  if (s.outcome === 'bored') client.track(botId, EVENTS.BORED_QUIT);
  client.track(botId, EVENTS.WALLS_PASSED, s.best);

  // Compact replay: flap frames as base-36 gaps ("a,3,f" = flap at 10, 13, 28).
  const replay = s.runs.map((r) => ({
    f: r.flaps.map((x, i) => (x - (r.flaps[i - 1] ?? 0)).toString(36)).join(','),
    n: r.frames, w: r.walls, e: r.end,
  }));
  return { botId, n, arm, mode, botSeed, traits, outcome: s.outcome, best: s.best, playedSec: s.playedSec, runs: replay };
}

// ---- 3. Run every bot, at most 20 at the same time when talking to the network ----
async function runAll(client, pop = {}, quiet = false) {
  const results = new Array(total);
  let next = 0, done = 0;
  async function worker() {
    while (next < total) {
      const n = next++;
      results[n] = await runBot(client, n, pop);
      done++;
      if (!quiet && (done % 500 === 0 || done === total)) process.stderr.write(`  ${done}/${total} bots played\n`);
    }
  }
  await Promise.all(Array.from({ length: dryRun ? 1 : 20 }, worker));
  return results;
}

// ---- 4. Numbers per arm ----
// Order arms: normal/control first (the baseline), then the variants.
const order = (arm) => MODES.indexOf(arm === 'control' ? 'normal' : arm);
const count = (list, o) => list.filter((r) => r.outcome === o).length;
const pct = (list, o) => (list.length ? (100 * count(list, o)) / list.length : 0);

function armStats(results) {
  const arms = [...new Set(results.map((r) => r.arm))].sort((a, b) => order(a) - order(b));
  return arms.map((arm) => {
    const g = results.filter((r) => r.arm === arm);
    return {
      arm, g, bots: g.length,
      l3: pct(g, 'level3'), rage: pct(g, 'rage'), bored: pct(g, 'bored'),
      walls: g.reduce((s, r) => s + r.best, 0) / g.length,
    };
  });
}

// "61.3% (+11.6pp, +23%)": absolute value, then the change vs the baseline arm.
function vsBase(v, b, isBase, unit = '%') {
  const abs = v.toFixed(1) + unit;
  if (isBase) return abs;
  const sign = (x) => (x >= 0 ? '+' : '');
  const pp = sign(v - b) + (v - b).toFixed(1) + (unit === '%' ? 'pp' : '');
  const rel = b ? sign(v - b) + ((100 * (v - b)) / b).toFixed(0) + '%' : 'n/a';
  return `${abs} (${pp}, ${rel})`;
}

// Normal-distribution CDF Phi(z), using a classic erf approximation (accurate to ~1e-7).
function phi(z) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

function summarise(results) {
  const stats = armStats(results), base = stats[0];
  console.log(`\nLevel Up simulation  tag=${tag}  seed=${seed}  bots=${total}  ${dryRun ? 'DRY RUN (offline)' : 'LIVE (Flagsmith)'}${aa ? '  A/A: everyone plays normal' : ''}`);
  console.table(stats.map((s, i) => ({
    arm: s.arm, bots: s.bots,
    reached_level_3: vsBase(s.l3, base.l3, i === 0),
    rage_quit: vsBase(s.rage, base.rage, i === 0),
    bored_quit: vsBase(s.bored, base.bored, i === 0),
    mean_walls: vsBase(s.walls, base.walls, i === 0, ''),
  })));
  console.log(`Changes are vs "${base.arm}": pp = percentage points, % = relative lift.`);

  // Who gets bored? Skilled bots vs everyone else, per arm.
  console.log(`Bored quits, skilled (aimNoise < ${SKILLED_NOISE}px) vs others:`);
  for (const s of stats) {
    const sk = s.g.filter((r) => r.traits.aimNoise < SKILLED_NOISE), other = s.g.filter((r) => r.traits.aimNoise >= SKILLED_NOISE);
    console.log(`  ${s.arm.padEnd(15)} ${String(count(s.g, 'bored')).padStart(4)} bored quits | skilled ${count(sk, 'bored')}/${sk.length} (${pct(sk, 'bored').toFixed(1)}%) | others ${count(other, 'bored')}/${other.length} (${pct(other, 'bored').toFixed(1)}%)`);
  }

  // Two-proportion z-test on reached_level_3, variant vs baseline.
  console.log('reached_level_3, local sanity check (Flagsmith\'s Bayesian result is the official one):');
  for (const s of stats.slice(1)) {
    const x1 = count(base.g, 'level3'), x2 = count(s.g, 'level3');
    const p = (x1 + x2) / (base.bots + s.bots); // pooled rate
    const z = (x2 / s.bots - x1 / base.bots) / Math.sqrt(p * (1 - p) * (1 / base.bots + 1 / s.bots));
    console.log(`  ${s.arm} vs ${base.arm}: z = ${z.toFixed(2)}, approx P(beat ${base.arm}) = ${(100 * phi(z)).toFixed(1)}%`);
  }
  console.log('Traffic is simulated by robot players.');
  if (aa) console.log('A/A NOTE: run this offline (--dry) or against a SEPARATE Flagsmith environment\n' +
    '(key FLAGSMITH_SERVER_KEY_AA). The real experiment flag is locked once started: never send A/A traffic to it.');
}

// ---- 5. Split check (sample ratio mismatch) ----
// Were bots split evenly between the 3 arms? Chi-square goodness-of-fit test.
function splitCheck(results) {
  const counts = {};
  for (const r of results) counts[r.arm] = (counts[r.arm] || 0) + 1;
  const arms = Object.keys(counts).sort((a, b) => order(a) - order(b));
  assert.equal(arms.length, 3, 'split check expects exactly 3 arms');
  const expected = results.length / 3;
  // chi-square statistic = sum of (observed - expected)^2 / expected
  const chi2 = arms.reduce((s, a) => s + (counts[a] - expected) ** 2 / expected, 0);
  const p = Math.exp(-chi2 / 2); // exact p-value for chi-square with df = 2 (3 arms)
  console.log(`exposures per arm: ${arms.map((a) => `${a}=${counts[a]}`).join('  ')}  (expected ${expected.toFixed(0)} each)`);
  console.log(`split check: ${p >= 0.001 ? 'PASS' : 'FAIL'} (chi2 = ${chi2.toFixed(2)}, df = 2, p = ${p.toPrecision(3)})`);
}

// ---- 6. Sensitivity: does the direction hold for other kinds of players? ----
async function runSensitivity() {
  const pops = { baseline: {}, 'more skilled': { aimScale: 0.75 }, 'less patient': { patienceDelta: -1 } };
  const rows = [];
  for (const [name, pop] of Object.entries(pops)) {
    process.stderr.write(`  population: ${name}\n`);
    const client = await createFlagClient({ dryRun: true, runTag: tag });
    const stats = armStats(await runAll(client, pop, true));
    const base = stats[0];
    for (const s of stats) rows.push({
      population: name, arm: s.arm,
      reached_level_3: vsBase(s.l3, base.l3, s === base),
      rage_quit: s.rage.toFixed(1) + '%', bored_quit: s.bored.toFixed(1) + '%',
    });
  }
  console.log(`\nSensitivity check (dry, seed=${seed}, bots=${total} per population)`);
  console.table(rows);
}

// ---- 7. Main ----
if (sensitivity) { await runSensitivity(); process.exit(0); }

const file = `runs/${tag}.json`;
if (!dryRun && existsSync(file)) {
  console.error(`${file} already exists. Live runs must use a new --tag (bot ids would repeat).`);
  process.exit(1);
}
// aa: the adapter uses the separate A/A key (FLAGSMITH_SERVER_KEY_AA) and forces 'normal'.
const client = await createFlagClient({ dryRun, runTag: tag, aa, flag: opt('flag') });
const started = Date.now();
const results = await runAll(client);
await client.close(); // flush every event before we exit

mkdirSync('runs', { recursive: true });
writeFileSync(file, JSON.stringify({ tag, seed, aa, dryRun, createdAt: new Date().toISOString(), bots: results }));
summarise(results);
splitCheck(results);
const st = client.stats || {};
console.log(`flags: exposures=${st.exposures} events=${st.events} fallbacks=${st.fallbacks}`);
if (st.fallbacks > 0) {
  console.log(`\n!!! WARNING: ${st.fallbacks} bots fell back to 'normal' because Flagsmith failed.\n` +
    '!!! These bots did not get a real assignment: this run is NOT a valid experiment.\n');
}

// --sample: a small copy for the Arena page (12 bots per lane + the full-run rates).
if (args.includes('--sample') && !aa) {
  const full = {};
  for (const s of armStats(results)) full[s.arm] = { bots: s.bots, level3: s.l3, rage: s.rage, bored: s.bored };
  const sample = MODES.flatMap((m) => results.filter((r) => r.mode === m).slice(0, 12));
  mkdirSync('web/public', { recursive: true });
  writeFileSync('web/public/arena-sample.json', JSON.stringify({ tag, seed, full, bots: sample }));
  console.log('Wrote web/public/arena-sample.json');
}
console.log(`Saved ${file} (${results.length} bots) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
