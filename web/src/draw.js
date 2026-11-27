// Draws one game state on a canvas. Used by the human game and by the Arena.
import { WORLD, BIRD_X, BIRD_R, WALL_W, inPractice } from '../../engine/game.js';

// opts.color = character colour, opts.dim = true draws a faded (finished) game
export function drawGame(ctx, game, opts = {}) {
  const { W, H } = WORLD;
  ctx.save();
  ctx.scale(ctx.canvas.width / W, ctx.canvas.height / H); // world units -> canvas pixels

  // Background: a soft vertical gradient.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#141b2d');
  sky.addColorStop(1, '#0b0f19');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Walls: solid blocks above and below the gap. Ghost (practice) walls are see-through.
  for (const w of game.walls) {
    ctx.fillStyle = w.ghost ? 'rgba(160,170,200,0.18)' : '#2e3a55';
    const top = w.gapY - w.gap / 2, bottom = w.gapY + w.gap / 2;
    ctx.fillRect(w.x, 0, WALL_W, top);
    ctx.fillRect(w.x, bottom, WALL_W, H - bottom);
    if (!w.ghost) { // bright edges make the gap easy to read
      ctx.fillStyle = '#4b5d85';
      ctx.fillRect(w.x, top - 6, WALL_W, 6);
      ctx.fillRect(w.x, bottom, WALL_W, 6);
    }
  }

  // The character: a circle with an eye.
  ctx.globalAlpha = opts.dim ? 0.35 : 1;
  ctx.fillStyle = game.over ? '#ff5d6c' : (opts.color || '#ffd166');
  ctx.beginPath();
  ctx.arc(BIRD_X, game.y, BIRD_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0b0f19';
  ctx.beginPath();
  ctx.arc(BIRD_X + 5, game.y - 3, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // "Practice" label while ghost walls are on.
  if (inPractice(game)) {
    ctx.fillStyle = 'rgba(200,210,255,0.8)';
    ctx.font = 'bold 36px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Practice', W / 2, 80);
  }
  ctx.restore();
}
