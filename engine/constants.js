// Shared names and numbers used by the game, the bots and the web page.
// Keeping them in ONE file means a typo can never make the bots and the
// browser send different event names to Flagsmith.

// The Flagsmith feature flag that decides how Level 1 feels.
export const FLAG = 'level1_mode';

// The three versions of Level 1 we are comparing.
export const MODES = ['normal', 'gentle_ramp', 'practice_first'];

// Event names (case-sensitive!) tracked as experiment metrics.
export const EVENTS = {
  REACHED_LEVEL_3: 'reached_level_3', // goal: player passed 20 walls in one run
  RAGE_QUIT: 'rage_quit',             // guardrail: quit after a streak of fast crashes
  BORED_QUIT: 'bored_quit',           // guardrail: quit because it felt too easy
  WALLS_PASSED: 'walls_passed',       // secondary: best run's wall count (sent once)
};

// Level sizes: Level 1 = walls 1-10, Level 2 = walls 11-20, Level 3 = wall 21+.
export const WALLS_PER_LEVEL = 10;
export const LEVEL_3_AT = 20;   // passing this many walls in one run = reached Level 3
export const MAX_RUNS = 25;     // a session ends after this many tries

// Fixed physics timestep: the game always advances in 1/60 s slices.
export const DT = 1000 / 60;
