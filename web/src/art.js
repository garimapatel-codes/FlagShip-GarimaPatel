// Pixel art for "Level Up: Kite Fight". Everything is drawn by this code:
// no image files, no fonts, no outside assets.
//
// How it works: each picture (a "sprite") is painted ONCE, pixel by pixel, into a
// small hidden canvas. draw.js then stamps these small canvases onto the game,
// scaled up with smoothing turned off, so every art pixel stays a crisp square.
// One art pixel = 2 world units (the world is 400 x 600 units).

export const PX = 2; // world units per art pixel

// ---- Palette ----
export const C = {
  ink: '#2a1a1f',      // thick near-black outlines
  pink: '#ff5fa2', pinkLight: '#ff9cc8', magenta: '#d6247f',
  orange: '#ff8a3d', yellow: '#ffd23f', yellowLight: '#ffe98a',
  cream: '#fff3d6', white: '#ffffff', plum: '#a3195c', cheek: '#ffc2dc',
};

// ---- Helpers ----

// Make a w x h hidden canvas and let paint(put, ctx) colour single pixels on it.
export function sprite(w, h, paint) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const put = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1); };
  paint(put, ctx);
  return cv;
}

// Turn a little text picture into a sprite. Each character is one pixel:
// '.' = see-through, other letters are looked up in `colors`.
export function fromMap(rows, colors) {
  return sprite(rows[0].length, rows.length, (put) => {
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (colors[ch]) put(x, y, colors[ch]); }));
  });
}

// Add a 1-pixel outline around every filled pixel of a sprite (returns a new, bigger sprite).
export function outlined(src, color = C.ink) {
  const { width: w, height: h } = src;
  const data = src.getContext('2d').getImageData(0, 0, w, h).data;
  const filled = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 0;
  return sprite(w + 2, h + 2, (put, ctx) => {
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
      if (!filled(x, y) && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))) put(x + 1, y + 1, color);
    }
    ctx.drawImage(src, 1, 1);
  });
}

// ---- Pixel font (our own 5x7 letters) ----
// Each glyph is 7 rows; each row is a 5-bit number written in hex (bit 16 = left pixel).
const FONT = {
  A: '0e11111f111111', B: '1e11111e11111e', C: '0e11101010110e', D: '1e11111111111e',
  E: '1f10101e10101f', F: '1f10101e101010', G: '0e11101711110f', H: '1111111f111111',
  I: '0e04040404040e', J: '0702020202120c', K: '11121418141211', L: '1010101010101f',
  M: '111b1515111111', N: '11111915131111', O: '0e11111111110e', P: '1e11111e101010',
  Q: '0e11111115120d', R: '1e11111e141211', S: '0f10100e01011e', T: '1f040404040404',
  U: '1111111111110e', V: '11111111110a04', W: '1111111515150a', X: '11110a040a1111',
  Y: '1111110a040404', Z: '1f01020408101f',
  0: '0e11111111110e', 1: '040c040404040e', 2: '0e1101060c101f', 3: '1e01010e01011e',
  4: '02060a121f0202', 5: '1f10101e01011e', 6: '0e10101e11110e', 7: '1f010204080808',
  8: '0e11110e11110e', 9: '0e11110f01010e',
  '!': '04040404040004', '-': '0000000e000000', ':': '000c0c000c0c00', '.': '0000000000000c',
  "'": '0c040800000000', '?': '0e110102040004', ' ': '00000000000000',
};
const glyphRows = (ch) => {
  const hex = FONT[ch] || FONT['?'];
  return Array.from({ length: 7 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
};

// Text as a sprite: coloured letters, an ink outline and a 1-pixel drop shadow (bold = thicker).
// Results are cached because the same words are drawn every frame.
const textCache = new Map();
export function textSprite(str, fill = C.white, shadow = C.magenta, bold = false) {
  const key = [str, fill, shadow, bold].join('|');
  if (textCache.has(key)) return textCache.get(key);
  if (textCache.size > 300) textCache.clear(); // keep memory small
  const chars = [...str.toUpperCase()];
  const step = bold ? 7 : 6; // bold letters are one pixel wider (each pixel is doubled sideways)
  const letters = sprite(Math.max(1, chars.length * step - 1), 7, (put) => {
    chars.forEach((ch, i) => glyphRows(ch).forEach((bits, y) => {
      for (let x = 0; x < 5; x++) if (bits & (16 >> x)) {
        put(i * step + x, y, fill);
        if (bold) put(i * step + x + 1, y, fill);
      }
    }));
  });
  const withInk = outlined(letters);
  // Shadow: the outlined text again, one pixel lower, in the shadow colour.
  const out = sprite(withInk.width, withInk.height + 1, (put, ctx) => {
    if (shadow) {
      ctx.drawImage(withInk, 0, 1);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = shadow; ctx.fillRect(0, 0, withInk.width, withInk.height + 1);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(withInk, 0, 0);
  });
  textCache.set(key, out);
  return out;
}

// ---- The player: a cheerful diamond kite with a face ----
// Every pixel is worked out from a few shapes (diamond, eyes, smile), measured in world
// units, so we can paint the kite already tilted and still get a clean outline.
// The kite uses finer pixels (KITE_PX) than the scenery so its face stays readable.
// look = 'up' | 'mid' | 'down' (where the eyes look) or 'dizzy' (after a crash).
export const KITE_PX = 1.25;  // world units per kite pixel
const KITE = 30;              // sprite size in kite pixels (37.5 units; the hitbox is 24 wide)
const kiteCache = new Map();  // sprites are made once, then reused
export function kiteSprite(look, tiltStep) {
  const key = look + tiltStep;
  if (kiteCache.has(key)) return kiteCache.get(key);
  const angle = tiltStep * 0.1, cos = Math.cos(angle), sin = Math.sin(angle);
  const c = (KITE - 1) / 2;
  const body = sprite(KITE, KITE, (put) => {
    for (let y = 0; y < KITE; y++) for (let x = 0; x < KITE; x++) {
      // (u, v) = this pixel in the kite's own, untilted coordinates, in world units (v points down).
      const px = (x - c) * KITE_PX, py = (y - c) * KITE_PX;
      const u = px * cos + py * sin, v = -px * sin + py * cos;
      const shape = Math.abs(u / 14) ** 1.25 + Math.abs(v / 16) ** 1.25; // < 1 = inside the diamond
      if (shape > 1) continue;
      const col = kitePixel(u, v, shape, look, Math.floor((x + y) / 2));
      if (col) put(x, y, col);
    }
  });
  const out = outlined(outlined(body)); // a thick (2-pixel) ink outline
  kiteCache.set(key, out);
  return out;
}
function kitePixel(u, v, shape, look, dash) {
  const d = (cx, cy) => Math.hypot(u - cx, v - cy);
  for (const ex of [-5.6, 5.6]) { // two big googly eyes
    const r = d(ex, -1.8);
    if (r < 5.4) {
      if (r > 4.2) return C.ink;
      if (look === 'dizzy') { // little x eyes
        const du = Math.abs(u - ex), dv = Math.abs(v + 1.8);
        return Math.abs(du - dv) < 0.9 && r < 3.4 ? C.ink : C.white;
      }
      const py = look === 'up' ? -1.9 : look === 'down' ? 1.7 : 0; // pupils follow the motion
      if (d(ex + 0.4, -2.6 + py) < 0.9) return C.white;  // shine
      if (d(ex + 0.7, -1.8 + py) < 2.1) return C.ink;
      return C.white;
    }
  }
  if (look === 'dizzy' ? d(0, 7) < 1.9 : (d(0, 2.4) > 3.6 && d(0, 2.4) < 5 && v > 4.6)) return C.ink; // mouth
  if (d(-9.6, 4.8) < 1.8 || d(9.6, 4.8) < 1.8) return C.cheek;               // rosy cheeks
  if (shape > 0.74 && shape < 0.86) return dash % 2 ? C.cream : null;        // dashed stitch line
  if (v < -9) return Math.abs(v + 10.2) < 0.7 ? C.magenta : C.yellow;       // top panel with a spar line
  if (v > 10) return Math.floor((u + 40) / 3) % 2 ? C.yellow : C.orange;     // striped bottom panel
  if (Math.abs(u) > 9.5) return C.orange;                                     // wing tips
  return C.pink;                                                              // the face panel
}
// A little bow knot for the ribbon tail.
export const bow = fromMap([
  'kk...kk',
  'kpk.kpk',
  'kppkppk',
  'kpk.kpk',
  'kk...kk',
], { k: C.ink, p: C.pink });

// ---- Obstacles: striped, stitched kite-string poles ----
// The body is one tall picture (30 x 300 art pixels = 60 x 600 world units, exactly one
// wall wide). draw.js cuts out the part it needs, so the art always fits the wall exactly.
export const POLE_W = 30, CAP_H = 10;
export const poleBody = sprite(POLE_W, 300, (put) => {
  for (let y = 0; y < 300; y++) for (let x = 0; x < POLE_W; x++) {
    let col;
    if (x < 2 || x >= POLE_W - 2) col = C.ink;                   // thick outline left and right
    else {
      const shade = x < 7 ? 1 : x > 22 ? -1 : 0;                  // light on the left, dark on the right
      const wrap = (y + Math.floor(x / 2)) % 22;                  // diagonal string wrapped around the pole
      if (wrap < 5) col = shade < 0 ? C.orange : C.yellow;
      else if (wrap === 5) col = C.ink;
      else col = shade > 0 ? C.pink : shade < 0 ? C.plum : C.magenta;
      if (x === 15 && wrap > 7 && wrap < 20 && y % 4 < 2) col = C.cream; // stitch line
    }
    put(x, y, col);
  }
});
// The bold cap at the gap edge: a yellow band with checks, outlined in ink.
export const poleCap = sprite(POLE_W, CAP_H, (put) => {
  for (let y = 0; y < CAP_H; y++) for (let x = 0; x < POLE_W; x++) {
    let col = C.yellow;
    if (y < 2 || y >= CAP_H - 2 || x < 2 || x >= POLE_W - 2) col = C.ink;
    else if (y === 2) col = C.yellowLight;
    else if (y >= 4 && y <= 5) col = (Math.floor(x / 2) + y) % 2 ? C.orange : C.cream; // checks
    put(x, y, col);
  }
});

// ---- Background ----

// Warm sky: soft bands with a checkerboard blend between them (classic pixel-art dithering).
export const sky = sprite(200, 300, (put) => {
  const bands = ['#ffd3c4', '#ffdbc8', '#ffe2cc', '#ffe8d1', '#ffedd5', '#fff1da', '#fff4df', '#fff6e4'];
  for (let y = 0; y < 300; y++) {
    const f = (y / 300) * bands.length, i = Math.floor(f);
    for (let x = 0; x < 200; x++) {
      const blend = f - i > 0.8 && (x + y) % 2 === 0 && i + 1 < bands.length; // dither near the next band
      put(x, y, bands[blend ? i + 1 : i]);
    }
  }
});

// Round things made of pixels: used for the sun and the clouds.
function blobs(w, h, circles, fill, rim, shade) {
  const inside = (x, y) => circles.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
  return sprite(w, h, (put) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      put(x, y, edge ? rim : shade && !inside(x, y + 2) ? shade : fill);
    }
  });
}
export const sun = blobs(44, 44, [[22, 22, 20]], '#fff0a8', '#ffe08a');
export const clouds = [
  blobs(40, 16, [[10, 10, 6], [19, 7, 7], [29, 10, 6], [20, 12, 4]], '#fffaf2', '#f6d8c8', '#fbe9dc'),
  blobs(28, 12, [[8, 8, 4], [15, 6, 5], [21, 8, 4]], '#fffaf2', '#f6d8c8', '#fbe9dc'),
  blobs(52, 18, [[10, 12, 6], [20, 8, 7], [32, 9, 8], [42, 12, 6], [26, 13, 5]], '#fffaf2', '#f6d8c8', '#fbe9dc'),
];

// Faraway character kites, in soft colours so they never compete with the obstacles.
const soft = { k: '#b97a88', p: '#ff9cc4', y: '#ffe08a', o: '#ffb27f', w: '#fffaf0', e: '#7a4a56' };
export const rivals = [
  // a fish kite
  fromMap([
    '...kkkk.....',
    '.kkooooyk..k',
    'kowekooyykkok',
    'kooooooyykook',
    '.kkooooyk..kk',
    '...kkkk.....',
  ].map((r) => r.padEnd(13, '.')), soft),
  // a butterfly kite
  fromMap([
    'kk.......kk',
    'kpk.....kpk',
    'kppk.k.kppk',
    'kpyykkkyypk',
    '.kppkekppk.',
    '.kyyk.kyyk.',
    '..kk...kk..',
  ], soft),
  // a jellyfish kite (its ribbon tentacles are drawn in draw.js)
  fromMap([
    '..kkkkk..',
    '.kpppppk.',
    'kpwepwepk',
    'kpppppppk',
    'kkkkkkkkk',
  ], soft),
];

// Rooftops of a town during kite season: flat terraces, water tanks, stair rooms,
// and tiny people flying kites. Two layers (far and near) for parallax.
function rooftops(seed, color, detail, minH, maxH, people) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); // tiny repeatable random
  return sprite(200, 80, (put) => {
    const col = (x, top) => { for (let y = top; y < 80; y++) put(x, y, color); };
    let x = 0;
    while (x < 200) {
      const w = 18 + Math.floor(rnd() * 22), h = minH + Math.floor(rnd() * (maxH - minH));
      const top = 80 - h;
      for (let i = x; i < Math.min(200, x + w); i++) col(i, top);
      for (let i = x; i < Math.min(200, x + w); i += 2) put(i, top - 1, color);            // parapet dashes
      for (let wy = top + 4; wy < 76; wy += 6) for (let wx = x + 3; wx < x + w - 3; wx += 5) {
        put(wx, wy, detail); put(wx + 1, wy, detail); put(wx, wy + 1, detail); put(wx + 1, wy + 1, detail); // windows
      }
      const extra = rnd();
      if (extra < 0.35) for (let i = x + 3; i < x + 9; i++) col(i, top - 4);                  // water tank
      else if (extra < 0.6) for (let i = x + w - 9; i < x + w - 2; i++) col(i, top - 6);      // stair room
      if (people && rnd() < 0.7) {                                                            // a kite flyer
        const px = x + 10 + Math.floor(rnd() * Math.max(1, w - 14));
        for (let y = top - 4; y < top; y++) put(px, y, detail);
        put(px, top - 5, detail); put(px + 1, top - 3, detail);                                // head and arm
        let kx = px + 1, ky = top - 4;
        for (let i = 0; i < 10; i++) { kx += 1; ky -= 2; put(kx, ky, detail); }                 // string
        put(kx, ky - 2, detail); put(kx - 1, ky - 1, detail); put(kx + 1, ky - 1, detail); put(kx, ky, detail); // tiny kite
      }
      x += w + Math.floor(rnd() * 4);
    }
  });
}
export const roofsFar = rooftops(7, '#f7d0c3', '#f9dccf', 30, 55, false);
export const roofsNear = rooftops(21, '#efb6a9', '#f5c8bb', 12, 34, true);

// The rooftop parapet along the bottom edge (decoration only; drawn 10 units tall).
// It is 23 art pixels (46 units) wide: 230, the distance between poles, is 5 x 46,
// so draw.js can lock the bricks to the poles and they move together.
export const parapet = sprite(23, 5, (put) => {
  for (let x = 0; x < 23; x++) {
    put(x, 0, C.ink);
    for (let y = 1; y < 5; y++) {
      const mortar = y === 2 || (y < 2 ? x === 0 : x === 11);
      put(x, y, mortar ? '#e89a7f' : y === 1 ? '#ffd9bd' : '#ffc9a6');
    }
  }
});
