// A tiny seeded random number generator (the "mulberry32" algorithm).
// Same seed -> same sequence of numbers, every time, on every computer.
// That is what makes every game and every robot run reproducible.

// Advance a 32-bit integer state one step and return [randomFloat0to1, nextState].
// Keeping the state as a plain number lets the game store it inside its state object.
export function nextRandom(state) {
  const s = (state + 0x6d2b79f5) | 0;          // move the state forward by a fixed odd number
  let t = Math.imul(s ^ (s >>> 15), 1 | s);      // scramble the bits...
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; // ...and scramble them again
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296; // turn into a number in [0, 1)
  return [value, s];
}

// Convenience wrapper: returns a function that gives a new random number each call.
export function makeRng(seed) {
  let state = seed | 0;
  return () => {
    const [value, next] = nextRandom(state);
    state = next;
    return value;
  };
}

// Turn any mix of numbers/strings into one 32-bit seed (FNV-1a hash).
// Example: hashSeed(42, 'bot', 7) always gives the same number.
export function hashSeed(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
