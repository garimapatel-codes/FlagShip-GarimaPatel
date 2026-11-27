// Draws one game state on a canvas. Used by the human game and by the Arena.
// The look is the same for every version of Level 1: only what the engine itself
// changes (gap size, speed, practice walls) can look different.
//
// opts.dim = true  -> fade the whole picture (a finished game in the Arena)
// opts.t           -> animation clock in frames (defaults to the game's own frame)
// opts.ui          -> { phase, best, newBest, canRetry } for the human game's title,
//                     score and "Kite down" card. The Arena leaves it out.
import { WORLD, BIRD_X, WALL_W, inPractice, level } from '../../engine/game.js';
import * as A from './art.js';

const { W, H } = WORLD;
const { C, PX } = A;
const CAP = A.CAP_H * PX; // cap height in world units

export function drawGame(ctx, game, opts = {}) {
  const t = opts.t ?? game.frame;
  ctx.save();
  ctx.imageSmoothingEnabled = false; // keep pixels square and crisp
  ctx.scale(ctx.canvas.width / W, ctx.canvas.height / H); // world units -> canvas pixels

  drawBackground(ctx, game, t);
  for (const w of game.walls) drawWall(ctx, w);
  drawPlayer(ctx, game, t, opts.ui);
  if (inPractice(game)) { // the "Practice" label, as before, while ghost walls are on
    label(ctx, 'PRACTICE ZONE', W / 2, opts.ui ? 76 : 16, 2, C.yellow);
  }
  if (opts.ui) drawUI(ctx, game, opts.ui, t);
  if (opts.dim) { ctx.fillStyle = 'rgba(255,243,214,0.55)'; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
}

// ---- Background: no collisions, soft colours so the poles always stand out ----
function drawBackground(ctx, game, t) {
  ctx.drawImage(A.sky, 0, 0, W, H);
  ctx.drawImage(A.sun, 268, 34, 88, 88);

  // Clouds drift slowly to the left and wrap around.
  const cloudSpots = [[40, 70, 0.10], [250, 150, 0.16], [140, 245, 0.07]];
  cloudSpots.forEach(([x0, y, speed], i) => {
    const img = A.clouds[i], w = img.width * PX;
    const x = wrap(x0 - t * speed, W + w) - w;
    ctx.drawImage(img, x, y, w, img.height * PX);
  });

  // Faraway character kites: a fish, a butterfly and a jellyfish, bobbing on long strings.
  const rivalSpots = [[60, 190, 0.22], [300, 230, 0.17], [190, 115, 0.12]];
  rivalSpots.forEach(([x0, y0, speed], i) => {
    const img = A.rivals[i], w = img.width * PX, h = img.height * PX;
    const x = wrap(x0 - t * speed, W + 60) - 30;
    const y = y0 + Math.sin(t * 0.03 + i * 2) * 6;
    ctx.fillStyle = 'rgba(214,140,140,0.35)'; // its string, fading as it slopes down
    for (let k = 1; k < 16; k++) ctx.fillRect(x + w / 2 - k * 3, y + h + k * 7, 2, 2);
    if (i === 2) { // jellyfish ribbon tentacles
      ctx.fillStyle = '#ffb3cf';
      for (let j = 0; j < 3; j++) for (let k = 0; k < 6; k++) {
        ctx.fillRect(x + 3 + j * 6 + Math.round(Math.sin(t * 0.1 + k + j) * 1.5) * 2, y + h + k * 4, 2, 4);
      }
    }
    ctx.drawImage(img, x, y, w, h);
  });

  // Rooftops: far ones move slowly, near ones faster (parallax).
  const travel = game.frame * 2.8;
  for (const [img, rate] of [[A.roofsFar, 0.2], [A.roofsNear, 0.45]]) {
    const x = -wrap(travel * rate, 400);
    ctx.drawImage(img, x, H - 160, 400, 160);
    ctx.drawImage(img, x + 400, H - 160, 400, 160);
  }

  // The parapet along the bottom. Poles are always 230 apart (= 5 bricks of 46), so
  // using the first pole's position keeps the bricks moving exactly with the poles.
  const first = game.walls[0];
  const shift = first ? wrap(first.x, 46) : 0;
  for (let x = shift - 46; x < W; x += 46) ctx.drawImage(A.parapet, x, H - 10, 46, 10);
}

// ---- Obstacles: each wall is drawn exactly inside the engine's wall rectangles ----
function drawWall(ctx, w) {
  const top = w.gapY - w.gap / 2, bottom = w.gapY + w.gap / 2;
  ctx.save();
  // Clip to the two solid rectangles, so nothing is drawn outside the real hitbox.
  ctx.beginPath();
  ctx.rect(w.x, 0, WALL_W, top);
  ctx.rect(w.x, bottom, WALL_W, H - bottom);
  ctx.clip();
  if (w.ghost) ctx.globalAlpha = 0.3; // practice walls are see-through
  const bodyH = A.poleBody.height;
  // Upper pole: take the bottom of the tall picture so the pattern starts at the cap.
  const upH = top - CAP;
  if (upH > 0) ctx.drawImage(A.poleBody, 0, bodyH - upH / PX, A.POLE_W, upH / PX, w.x, 0, WALL_W, upH);
  const lowH = H - bottom - CAP;
  if (lowH > 0) ctx.drawImage(A.poleBody, 0, 0, A.POLE_W, lowH / PX, w.x, bottom + CAP, WALL_W, lowH);
  // Bold caps right at the edges of the gap.
  ctx.drawImage(A.poleCap, w.x, top - CAP, WALL_W, CAP);
  ctx.drawImage(A.poleCap, w.x, bottom, WALL_W, CAP);
  ctx.restore();

  if (w.ghost) {
    // Dashed outline (inside the rectangles) and a small stacked "PRACTICE" label.
    ctx.save();
    ctx.strokeStyle = 'rgba(42,26,31,0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(w.x + 1, -2, WALL_W - 2, top + 1);
    ctx.strokeRect(w.x + 1, bottom + 1, WALL_W - 2, H - bottom + 2);
    ctx.restore();
    // Put the label in whichever part has more room (keeping clear of the badges at the top).
    const [y0, y1] = top - CAP - 110 > H - 10 - bottom - CAP ? [110, top - CAP] : [bottom + CAP, H - 10];
    const letters = 'PRACTICE';
    let y = (y0 + y1) / 2 - (letters.length * 18) / 2;
    for (const ch of letters) { text(ctx, ch, w.x + WALL_W / 2, y, 2, C.cream, null); y += 18; }
  }
}

// ---- The player's kite, its ribbon tail and its string ----
function drawPlayer(ctx, game, t, ui) {
  let y = game.y;
  if (ui && ui.phase === 'ready') y += Math.sin(t * 0.08) * 4; // gentle hover on the title screen
  const vy = ui && ui.phase === 'ready' ? 0 : game.vy;
  const tilt = Math.max(-0.3, Math.min(0.4, vy * 0.05)); // lean with vertical speed
  const look = game.over ? 'dizzy' : vy < -2.5 ? 'up' : vy > 3 ? 'down' : 'mid';

  // The string: a dotted line sagging down to someone on a rooftop off-screen (cut after a crash).
  if (!game.over) {
    ctx.fillStyle = 'rgba(42,26,31,0.5)';
    const ex = -20, ey = H + 30, cx = 20, cy = y + 120;
    for (let s = 0.02; s < 1; s += 0.025) {
      const a = (1 - s) * (1 - s), b = 2 * s * (1 - s), c = s * s; // a curved line (Bezier)
      ctx.fillRect(Math.round(a * BIRD_X + b * cx + c * ex), Math.round(a * y + b * cy + c * ey), 2, 2);
    }
  }

  // The ribbon tail hangs from the bottom tip and waves; little bows are tied along it.
  const tipX = BIRD_X - Math.sin(tilt) * 18, tipY = y + Math.cos(tilt) * 18;
  const points = [];
  for (let i = 1; i <= 14; i++) {
    const wave = Math.sin(i * 0.6 - t * 0.2) * i * 0.4;
    points.push([tipX - i * 2.6 + wave, tipY + i * 2.4 + wave * 0.6]);
  }
  ctx.fillStyle = C.ink;
  for (const [x, py] of points) ctx.fillRect(Math.round(x) - 3, Math.round(py) - 3, 6, 6);
  points.forEach(([x, py], i) => {
    ctx.fillStyle = Math.floor(i / 2) % 2 ? C.yellow : C.pink;
    ctx.fillRect(Math.round(x) - 1, Math.round(py) - 1, 2, 2);
    ctx.fillRect(Math.round(x) - 2, Math.round(py) - 1, 4, 2);
  });
  for (const i of [4, 9, 13]) {
    const [x, py] = points[i];
    ctx.drawImage(A.bow, Math.round(x) - 7, Math.round(py) - 5, 14, 10);
  }

  // The kite itself, centred on the engine's hitbox. It is painted already tilted
  // (in steps of 0.1 radian), which keeps its pixels and outline clean.
  const img = A.kiteSprite(look, Math.round(tilt / 0.1)), size = img.width * A.KITE_PX;
  ctx.drawImage(img, BIRD_X - size / 2, y - size / 2, size, size);
}

// ---- Title screen, score, level badge and the "Kite down" card ----
function drawUI(ctx, game, ui, t) {
  const blink = Math.floor(t / 30) % 2 === 0;
  if (ui.phase === 'ready') {
    text(ctx, 'LEVEL UP', W / 2, 92, 6, C.yellow, C.magenta);
    ribbon(ctx, 'KITE FIGHT', W / 2, 168);
    if (blink) text(ctx, 'TAP TO FLY', W / 2, 410, 4, C.white, C.pink);
    text(ctx, 'TAP - CLICK - SPACE', W / 2, 462, 2, C.cream, null);
    return;
  }
  // Score (big digits) at the top, level badge on the left, best on the right.
  text(ctx, String(game.wallsPassed), W / 2, 14, 5, C.white, C.magenta);
  label(ctx, 'LV ' + level(game), 44, 18, 2, C.pink);
  label(ctx, 'BEST ' + ui.best, W - 52, 18, 2, C.orange);

  if (ui.phase === 'over') {
    const x = 50, y = 170, w = 300, h = 250;
    box(ctx, x, y, w, h, C.cream);
    box(ctx, x + 14, y - 22, w - 28, 50, C.pink);          // header band
    text(ctx, 'KITE DOWN!', W / 2, y - 8, 3, C.white, C.magenta);
    text(ctx, 'SCORE', x + 80, y + 52, 2, C.orange, null);
    text(ctx, String(game.wallsPassed), x + 80, y + 78, 5, C.yellow, C.orange);
    text(ctx, 'BEST', x + w - 80, y + 52, 2, C.orange, null);
    text(ctx, String(ui.best), x + w - 80, y + 78, 5, C.pinkLight, C.magenta);
    if (ui.newBest) label(ctx, 'NEW BEST!', W / 2, y + 140, 2, C.yellow);
    if (ui.canRetry) {
      box(ctx, x + 30, y + h - 66, w - 60, 44, blink ? C.yellow : C.yellowLight);
      text(ctx, 'TAP TO TRY AGAIN', W / 2, y + h - 54, 2, C.white, null);
    }
  }
}

// ---- Small drawing helpers ----

// Pixel text centred on cx, with its top at y; scale = world units per font pixel.
function text(ctx, str, cx, y, scale, fill, shadow) {
  const img = A.textSprite(str, fill, shadow, scale >= 3); // big text is bold
  ctx.drawImage(img, Math.round(cx - (img.width * scale) / 2), Math.round(y), img.width * scale, img.height * scale);
}

// A rounded box with a thick ink border and a soft shadow (pixel-style corners).
function box(ctx, x, y, w, h, fill) {
  ctx.fillStyle = 'rgba(42,26,31,0.25)';
  ctx.fillRect(x + 4, y + 6, w, h);
  ctx.fillStyle = C.ink;
  ctx.fillRect(x + 4, y, w - 8, h);
  ctx.fillRect(x, y + 4, w, h - 8);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
}

// A small rounded tag with white text, centred on cx.
function label(ctx, str, cx, y, scale, fill) {
  const img = A.textSprite(str, C.white, null);
  const w = img.width * scale + 12, h = img.height * scale + 8;
  box(ctx, Math.round(cx - w / 2), y, w, h, fill);
  text(ctx, str, cx, y + 4, scale, C.white, null);
}

// A pink ribbon banner with folded ends, for the title.
function ribbon(ctx, str, cx, y) {
  const w = 250, h = 46;
  for (const side of [-1, 1]) { // the folded tails behind the banner
    const tx = side < 0 ? cx - w / 2 - 26 : cx + w / 2 - 14;
    box(ctx, tx, y + 14, 40, h - 6, C.magenta);
  }
  box(ctx, cx - w / 2, y, w, h, C.pink);
  text(ctx, str, cx, y + 12, 3, C.white, C.magenta);
}

// Keep a value in 0..size (like % but also for negative numbers).
function wrap(v, size) {
  return ((v % size) + size) % size;
}
