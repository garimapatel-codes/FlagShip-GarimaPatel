// Robot Arena: replays 12 bots per Level 1 version, side by side, with live counters.
// A replay = the same seed + the exact frames where the bot tapped, fed into the same engine.
import { createGame, step } from '../../engine/game.js';
import { MODES } from '../../engine/constants.js';
import { hashSeed } from '../../engine/rng.js';
import { drawGame } from './draw.js';

const PER_LANE = 12;
const LANES = {
  normal: { color: '#7aa2ff', title: 'normal', note: 'Full difficulty from wall 1' },
  gentle_ramp: { color: '#3ddc97', title: 'gentle_ramp', note: 'Wide, slow walls easing to normal by wall 10' },
  practice_first: { color: '#c08cff', title: 'practice_first', note: '10 s of harmless ghost walls first' },
};
const OUTCOME = { level3: ['LEVEL 3', 'ok'], rage: ['RAGE QUIT', 'bad'], bored: ['BORED QUIT', 'meh'], cap: ['GAVE UP', 'meh'] };
const $ = (id) => document.getElementById(id);
let players = [];   // one entry per bot tile
let lanes = {};     // per-lane DOM counters and tallies

// "a,3,f" (base-36 gaps) -> Set of absolute flap frames {10, 13, 28}
function decodeFlaps(text) {
  const frames = new Set();
  let t = 0;
  for (const part of text ? text.split(',') : []) { t += parseInt(part, 36); frames.add(t); }
  return frames;
}

// Full-run rates for one lane. A sample file carries them in data.full (from all bots
// of the simulation); a full runs/*.json file has every bot, so we count them here.
function fullStats(data, mode, bots) {
  let f = data.full && data.full[mode];
  if (!f) {
    const pct = (o) => (100 * bots.filter((b) => b.outcome === o).length) / (bots.length || 1);
    f = { bots: bots.length, level3: pct('level3'), rage: pct('rage'), bored: pct('bored') };
  }
  const shown = Math.min(PER_LANE, bots.length);
  return `Full run (${f.bots} bots): L3 ${f.level3.toFixed(1)}% · rage ${f.rage.toFixed(1)}% · bored ${f.bored.toFixed(1)}%<br>` +
    `Counters below: showing ${shown} of ${f.bots}`;
}

// Build the three lanes and their bot tiles from a run file.
function setup(data, label) {
  $('lanes').innerHTML = '';
  players = [];
  lanes = {};
  $('source').textContent = `${label} · seed ${data.seed} · tag ${data.tag}`;
  for (const mode of MODES) {
    const info = LANES[mode];
    const bots = data.bots.filter((b) => b.mode === mode);
    const lane = document.createElement('section');
    lane.className = 'lane';
    lane.style.setProperty('--c', info.color);
    lane.innerHTML = `
      <h2>${info.title}</h2><p class="muted">${info.note}</p>
      <p class="muted small">${fullStats(data, mode, bots)}</p>
      <div class="counters">
        <div><b data-k="level3">0</b><span>reached L3</span></div>
        <div><b data-k="rage">0</b><span>rage quits</span></div>
        <div><b data-k="bored">0</b><span>bored quits</span></div>
      </div>
      <div class="grid"></div>`;
    $('lanes').appendChild(lane);
    lanes[mode] = { el: lane, tally: { level3: 0, rage: 0, bored: 0 } };

    for (const bot of bots.slice(0, PER_LANE)) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.innerHTML = `<canvas width="120" height="180"></canvas><div class="cap"></div><div class="stamp"></div>`;
      lane.querySelector('.grid').appendChild(tile);
      const p = { bot, mode, tile, ctx: tile.querySelector('canvas').getContext('2d'), run: -1, game: null, flaps: null, done: false };
      nextRun(p);
      players.push(p);
    }
  }
}

// Start the bot's next recorded run, or finish its session.
function nextRun(p) {
  p.run += 1;
  const rec = p.bot.runs[p.run];
  if (!rec) return finish(p);
  p.game = createGame({ mode: p.mode, seed: hashSeed(p.bot.botSeed, p.run), runIndex: p.run });
  p.flaps = decodeFlaps(rec.f);
}

function finish(p) {
  p.done = true;
  const [text, cls] = OUTCOME[p.bot.outcome];
  p.tile.classList.add('done', cls);
  p.tile.querySelector('.stamp').textContent = text;
  const lane = lanes[p.mode];
  if (p.bot.outcome in lane.tally) {
    lane.tally[p.bot.outcome] += 1;
    const el = lane.el.querySelector(`[data-k="${p.bot.outcome}"]`);
    el.textContent = lane.tally[p.bot.outcome];
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); // replay the "pop" animation
  }
}

// Advance one bot by one physics frame.
function tick(p) {
  if (p.done) return;
  const rec = p.bot.runs[p.run];
  if (p.game.frame >= rec.n || p.game.over) return nextRun(p);
  step(p.game, { flap: p.flaps.has(p.game.frame) });
}

// Animation loop: several physics frames per screen refresh, depending on speed.
function loop() {
  const speed = Number($('speed').value);
  for (let i = 0; i < speed; i++) players.forEach(tick);
  for (const p of players) {
    if (!p.game) continue;
    drawGame(p.ctx, p.game, { color: LANES[p.mode].color, dim: p.done });
    p.tile.querySelector('.cap').textContent = `#${p.bot.n} · try ${Math.min(p.run + 1, p.bot.runs.length)} · ${p.game.wallsPassed} walls`;
  }
  requestAnimationFrame(loop);
}

// ---- Data loading: bundled sample, or a runs/*.json file the user picks ----
let current = null;
async function loadSample() {
  try {
    const res = await fetch('./arena-sample.json');
    current = [await res.json(), 'bundled sample'];
    setup(...current);
  } catch {
    $('source').textContent = 'No sample found. Run "npm run sim:dry -- --sample", then reload or load a runs/*.json file.';
  }
}
$('file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  current = [JSON.parse(await file.text()), file.name];
  setup(...current);
});
$('restart').addEventListener('click', () => current && setup(...current));

loadSample();
requestAnimationFrame(loop);
