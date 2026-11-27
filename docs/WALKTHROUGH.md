# Code walkthrough

This page explains every file in plain English. For each file you get:
- what it does;
- the key lines;
- questions a judge might ask, with short answers.

Read it next to the code. Every quoted line is copied from the code as it is now. If the code changes, update this page.

**The big picture**

```
 human (web/src/main.js)          robot (bots/sim.mjs + bots/brain.js)
          |                                   |
   web/src/flags.js                     bots/flags.mjs
   (Flagsmith JS SDK)                   (Flagsmith Node SDK)
          |  getExperimentFlag -> mode        |
          v                                   v
                 engine/  (the game itself: pure, seeded)
          |  game events                      |
          v  trackEvent                       v
              Flagsmith experiment -> results page
```

The engine *is* the game. The browser and the bots are two ways of playing it. Flagsmith decides which first try you get and counts what happens.

---

## 1. `engine/constants.js`: shared names and numbers

**What it does.** It holds the flag name, the three modes, the four event names, the level sizes and the physics timestep. It is a single file, imported by the game, the bots and the browser.

**Key lines**
```js
export const FLAG = 'level1_mode';
export const MODES = ['normal', 'gentle_ramp', 'practice_first'];
export const EVENTS = { REACHED_LEVEL_3: 'reached_level_3', RAGE_QUIT: 'rage_quit',
  BORED_QUIT: 'bored_quit', WALLS_PASSED: 'walls_passed' };
export const LEVEL_3_AT = 20;   // passing this many walls in one run = reached Level 3
export const MAX_RUNS = 25;     // a session ends after this many tries
export const DT = 1000 / 60;    // one physics step = 1/60 s
```

**Judge questions**
- *Why keep event names in one file?* Flagsmith metrics match event names exactly, and they are case-sensitive. If the bots and the browser each typed their own names, one typo would split the data into two metrics. With one file they cannot disagree.
- *What counts as Level 3?* Passing 20 walls in one try.

## 2. `engine/config.js`: what each mode changes

**What it does.** `modeConfig(mode, wallIndex, timeMs)` returns three things:
- `gap`: the opening height in pixels;
- `speed`: pixels per frame;
- `ghost`: true means harmless practice walls.

**Key lines**
```js
const cfg = { gap: NORMAL_GAP, speed: NORMAL_SPEED, ghost: false }; // 140 px, 2.8 px/frame
if (mode === 'gentle_ramp' && wallIndex < RAMP_WALLS) {
  const t = wallIndex / RAMP_WALLS;            // 0, 0.1, ... 0.9
  cfg.gap = NORMAL_GAP * (1.5 - 0.5 * t);      // 210 px at wall 1, shrinking toward 140
  cfg.speed = NORMAL_SPEED * (0.7 + 0.3 * t);  // 70% speed at wall 1, toward 100%
}
if (mode === 'practice_first' && timeMs < PRACTICE_MS) cfg.ghost = true; // first 10 s
```

**Judge questions**
- *Is everything after Level 1 the same?* Yes. For `gentle_ramp`, wall index 10 and later get the normal values, and a test checks this. For `practice_first`, only the first 10 seconds are different.
- *What happens with an unknown mode?* Neither `if` matches, so you get the normal values.

## 3. `engine/rng.js`: seeded random numbers

**What it does.** It is a tiny random number generator called "mulberry32". The same seed always gives the same sequence of numbers, on any computer. `hashSeed(...parts)` turns a list like `(42, 'bot', 7)` into one 32-bit seed, using FNV-1a.

**Key lines**
```js
export function nextRandom(state) {          // returns [number in 0..1, next state]
  const s = (state + 0x6d2b79f5) | 0;
  ...
  return [value, s];
}
```
The state is a plain number, so the game can store it inside its own state object. That is why a whole game can be replayed from its seed.

**Judge questions**
- *Why not `Math.random()`?* You can't seed it. With our generator, the same seed gives the same game, so every run can be replayed. The Arena depends on this.
- *Is it secure?* No, and it doesn't need to be. It is only used for wall positions and bot personalities.

## 4. `engine/game.js`: the game itself

**What it does.** It contains the whole game as pure logic: no drawing, no keyboard, no clock. Bots and humans call the same functions.

**Key functions**
- `createGame({ mode, seed, runIndex })` makes the state for one try. `runIndex` is the try number in the session, where 0 is the first try.
- `currentConfig(state, wallIndex)` is **the fairness rule**:
  ```js
  const mode = state.runIndex === 0 ? state.mode : 'normal';
  ```
  The variant only applies to the first try. Every retry is normal, in every arm.
- `spawnWall(state, x)` adds a wall at the right edge. Whether it is a ghost is decided **when it spawns**. Ghost walls get index −1, so they don't count as wall 1, 2 and so on. The gap centre is random, but never more than 210 px from the previous one, so every gap is reachable.
- `step(state, input, dtMs)` advances one frame, in this order:
  1. Physics: a flap sets the vertical speed to −7.5, then gravity adds 0.45 each frame.
  2. Walls move left. The speed is based on the next wall to pass (`state.wallsPassed`).
  3. A new wall spawns when the last one has moved 230 px in.
  4. Floor and ceiling: a crash, except during practice, where you bounce.
  5. Walls: if the character overlaps a solid (non-ghost) wall, we measure **clearance**, the pixels left between the character and the wall edge. Below 0 is a crash. When a wall is fully passed, the score goes up and `lastPass.clearance` records the tightest clearance.
- `level(state)` returns 1, 2 or 3 from the walls passed.
- `inPractice(state)` is true while the practice zone is on. It is only used to draw the "Practice" label.
- `observe(game)` returns **what a player can see**: `y`, `vy`, `gapY`, `gap`, `wallsPassed`, `over`, `frame`, `clearance`. There is no mode, no try number and no ghost flag.
- `makeScreen(game)` returns `{ look, tap }`. This is the only thing a robot ever gets.

**Judge questions**
- *Is the engine the same for bots and humans?* Yes: the same file, with no DOM, imported by both.
- *Why a fixed timestep?* So that a bot running at a thousand times real speed and a human at real speed get exactly the same physics.
- *Why is clearance measured?* It measures how close the call was. A big clearance means the wall was easy. The bots use it to feel boredom, and the same number exists for any player.
- *Does a practice wall count as wall 1?* No. Ghost walls never score and get index −1.
- *Can the bot tell a ghost wall from a real one?* No. `observe` doesn't include the ghost flag. It sees a gap and plays it like any other.

## 5. `bots/brain.js`: the robot player

**What it does.** It gives each bot a personality, decides when to flap, and decides when the bot quits. **It never sees the mode.** It doesn't even import `createGame` or `step`.

**Traits** (`makeTraits(seed, n, pop)`) are drawn once per bot, from the seed and the bot number only:

| Trait | Formula (in words) | Meaning |
| --- | --- | --- |
| `reactionMs` | bell curve around 230 ms (spread 60), kept within 120–420 | how late it reacts |
| `aimNoise` | about 14 px times a random factor (log-normal), kept within 3–60 | how imprecise it is; small means skilled |
| `patience` | 1 to 5 | fast crashes in a row it tolerates |
| `boredomThreshold` | 0.35 to 0.95 | how much easy play it tolerates |

`pop` is only used by `--sensitivity`. `aimScale` below 1 gives a more skilled crowd, and `patienceDelta` below 0 gives a less patient one.

**Flapping** (`makeController`):
- **Reaction delay.** The bot acts on what the screen showed `reactionMs` ago: `seen[seen.length - 1 - delay]`.
- **Aim error.** For each new wall it picks a random aiming error. Beginners aim worse, and the error shrinks as the bot plays:
  ```js
  const skill = traits.aimNoise * (1 + BRAIN.NOVICE_EXTRA * Math.exp(-mind.playedSec / BRAIN.LEARN_SEC));
  ```
  A brand-new bot aims 3.5 times worse than its trait. After 15 seconds of play, the extra error has shrunk by about 63%.
- **Waiting after a tap.** After flapping, it waits one reaction time before it can flap again, like a person.
- **When to tap.** It predicts its current height from the old view using gravity. It flaps when it would sink below a point a little under the gap's centre, shifted by its aim error.

**Boredom** (`easiness`):
```js
const easyFrom = BRAIN.EASY_BASE + BRAIN.EASY_PER_NOISE * traits.aimNoise; // 1.3 x aimNoise
return clamp((clearance - easyFrom) / BRAIN.BORING_SPAN, 0, 1);            // 0 = tense, 1 = boring
```
A precise bot needs less room to feel safe, so the same wide gap bores it sooner. This is "skill-relative" boredom.

**The session** (`playSession(traits, seed, newScreen)`):
- It plays tries until Level 3, a quit, or 25 tries. `newScreen(r)` is passed in by the caller, so the brain never builds the game itself.
- Every frame, `playedSec` goes up. Practice time counts too, so bots learn during practice.
- When a wall is passed (`clearance` is not null), the boredom meter becomes a slow average: `0.8 × old + 0.2 × easiness`. Above `boredomThreshold`, the bot quits with `bored`.
- 20 walls in one try gives `level3`.
- On a crash, boredom drops to 30% of its value, because a crash is exciting. A crash before 3 walls is a "fast crash". More fast crashes in a row than `patience` means `rage`. Any try that reaches 3 walls resets the streak.
- The result is `{ outcome, best, runs, playedSec }`. `runs` stores the frames where it flapped, so the Arena can replay it.

**Judge questions**
- *Does the brain ever see the variant?* No. It only gets `screen.look()` and `screen.tap()`. `test/brain.test.js` wraps the game in a Proxy that throws if `mode`, `runIndex` or `ghost` is read. Another test checks that the word "mode" (and the variant names) never appear in the code of `brain.js`.
- *Where does the bot get bored in practice mode?* It doesn't. Ghost walls never set `clearance`, so the boredom meter only moves on real walls.
- *Why does `practice_first` do well?* Bots learn from time played. Ten crash-free seconds of practice cut a beginner's extra aiming error roughly in half, and the real game then starts at full difficulty, so skilled bots aren't bored. This is a modelling assumption, and we list it as a limitation.
- *Why does `gentle_ramp` bore people?* Its first walls are up to 210 px tall, against 140 normally. A skilled bot (small `aimNoise`) passes them with lots of room, so easiness is high and the meter climbs.
- *Could you tune the bots to make a variant win?* The knobs are all in `BRAIN` and `makeTraits`, out in the open. They are the same for every arm and frozen in git before the live run. Anyone can change them and rerun, and `--sensitivity` does that for three populations.

## 6. `bots/flags.mjs`: talking to Flagsmith (Node)

**What it does.** `createFlagClient({ dryRun, runTag, aa, flag })` returns an object with `getLevelMode`, `track`, `close`, `stats` and `variantOf`.

**Main parts**
- `loadEnv()`: a tiny `.env` reader. It never overwrites a variable that is already set, and it never prints a key.
- `stableHash(text)`: FNV-1a plus a final mix step, used for the dry-run split.
- **Dry run.** `VARIANT_KEYS[stableHash(`${flagName}:${botId}`) % 3]` picks the arm. Events go into an in-memory list, and nothing touches the network.
- **Real run.**
  ```js
  flagsmith = new Flagsmith({ environmentKey: key, enableEvents: true,
    eventProcessorConfig: { maxBuffer: 5000, flushInterval: 2000 } });
  const result = await flagsmith.getExperimentFlag(flagName, botId); // value + exposure
  flagsmith.trackEvent(eventName, { identifier: botId, value });
  await flagsmith.close(30000);                                     // send what's left
  ```
  It also calls `flushEvents()` every 500 events so the buffer never overflows.
- **Fallbacks.** If there is no key, the SDK fails, the flag is disabled or the value is unknown, the bot plays `normal`, one warning is printed, and `stats.fallbacks` goes up.
- **A/A mode.** It uses `FLAGSMITH_SERVER_KEY_AA`, a separate environment. Flagsmith assigns a real arm and records a real exposure, but the bot plays `normal`.

**Judge questions**
- *Where is the exposure recorded?* Inside `getExperimentFlag`, once per bot, just before it plays.
- *What if Flagsmith is down?* Every bot plays `normal` and the summary prints a big warning that the run is **not** a valid experiment.
- *Why `close()`?* The SDK sends events in batches. `close` sends the last batch before the process exits.
- *Why `maxBuffer: 5000`?* The default buffer holds 1,000 events and drops the oldest when full. Our bots produce events faster than a person.
- *Is the dry-run split the same as Flagsmith's?* No. It is a local stand-in for offline work. The official split comes from Flagsmith.
- *What if a bot isn't enrolled in the experiment?* The adapter warns once, and that bot isn't counted in `stats.exposures`. After a live run, `exposures` should equal the number of bots.

## 7. `bots/sim.mjs`: running the robots

**What it does.** It runs N bots, sends their events, prints checks, and saves `runs/<tag>.json`.

**Options:** `--dry`, `--bots N` (default 4500), `--seed N` (default 42), `--tag NAME`, `--aa`, `--flag NAME`, `--sample` (writes the Arena sample), `--sensitivity` (dry only).

**Per bot** (`runBot`):
```js
const traits = makeTraits(seed, n, pop);           // drawn BEFORE we know the mode
const flagMode = await client.getLevelMode(botId); // records the exposure
const newScreen = (runIndex) => makeScreen(createGame({ mode, seed: hashSeed(botSeed, runIndex), runIndex }));
const s = playSession(traits, botSeed, newScreen);
```
Then it sends at most one of `reached_level_3`, `rage_quit` or `bored_quit`, and always one `walls_passed` with the best try's walls. A session that hits 25 tries sends only `walls_passed`.

**Checks printed**
- **Summary table** per arm: each rate, with the change against `normal` in points and in percent.
- **Skilled vs others** (skilled means `aimNoise` below 10 px): who the bored quits are.
- **Local sanity check.** A two-proportion z-test on `reached_level_3`, with `Phi(z)` as an approximate "P(beat)". This is a frequentist shortcut, not Flagsmith's Bayesian number. The code says so in its output.
- **Split check.** A chi-square test of the per-arm counts against an even split:
  ```js
  const p = Math.exp(-chi2 / 2); // exact p-value for chi-square with df = 2 (3 arms)
  ```
  It prints PASS if p is at least 0.001, the same threshold Flagsmith uses for its SRM warning.
- **Flags line:** `exposures`, `events`, `fallbacks`. Fallbacks must be 0.

**Safety:** a live run refuses to start if `runs/<tag>.json` already exists, because the bot ids would repeat. Live tags include a timestamp. The dry run runs one bot at a time; the live run runs 20 at a time.

**Judge questions**
- *Why 4,500 bots?* About 1,500 per arm, sized in `HYPOTHESIS.md`.
- *Why is `exp(-chi2/2)` the p-value?* With 3 arms there are 2 degrees of freedom, and for 2 degrees of freedom the chi-square tail has exactly that formula.
- *How do you run the A/A check?* Offline with `npm run sim:dry -- --aa`, or live in the separate environment with `npm run sim -- --aa --bots 1500`.
- *What does `--sensitivity` do?* It reruns the dry run for three populations (baseline, more skilled, less patient) to see whether the direction holds.

## 8. `web/src/flags.js`: talking to Flagsmith (browser)

**What it does.** It connects the human game to Flagsmith, and never throws.

**Key lines**
```js
await flagsmith.init({ environmentID: CLIENT_KEY, enableEvents: true });
await flagsmith.identify(playerId);              // identify BEFORE reading the flag
const flag = flagsmith.getExperimentFlag(FLAG);  // value + exposure
flagsmith.trackEvent(eventName, value === undefined ? undefined : { value });
```
- `getOrCreatePlayerId()` keeps a random `human-xxxxxxxx` id in `localStorage`, so a reload is the same player.
- With no `VITE_FLAGSMITH_CLIENT_KEY` it goes offline: everyone plays `normal`, and `track` does nothing.

**Judge questions**
- *Which key is in the browser?* The client-side key, which is public by design. The server key is only used by the bots on our machine.
- *Will a reload change your version?* No. It is the same stored id, and Flagsmith's bucketing is deterministic for an identity.
- *When are events sent?* On `flush()` at session end, and on `pagehide`.

## 9. `web/src/main.js` and `web/index.html`: the human game

**What it does.** It runs the canvas game for humans, using the same engine.

**Main parts**
- `start()` asks Flagsmith for the mode once per page visit, which records the exposure. `?debug` in the URL shows a `mode: …` badge.
- `tap()` handles keyboard, mouse and touch. After a crash, a tap starts a new try with `runIndex += 1`, so a retry is normal, the same as for bots.
- The main loop runs fixed 1/60 s physics steps and draws once per screen refresh.
- **Events from humans:** `reached_level_3` once, when 20 walls are passed. `walls_passed` (best try) once, when the tab is hidden or closed.

**Judge questions**
- *Do humans send rage and bored quits?* No. A closed tab doesn't tell us *why* someone left, so we don't guess. Those two guardrails are bot-only.
- *What is `?debug` for?* Demos. After the rollout, it shows that every new player gets the winner.
- *Are human games reproducible?* No. Humans get a time-based seed. Only bot runs are replayable.

## 10. `web/src/arena.js` and `web/arena.html`: the Robot Arena

**What it does.** It replays 12 bots per version side by side, from `arena-sample.json` (made by `npm run sim:dry -- --sample`) or from any `runs/*.json` file you load.

**How a replay works:** the same seed (`hashSeed(bot.botSeed, run)`, the same as the sim), plus the exact frames where the bot tapped, fed into the same engine. `decodeFlaps` turns `"a,3,f"` (base-36 gaps) back into frame numbers. The header of each lane shows the **full-run** rates, so 12 bots never get mistaken for the result.

**Judge questions**
- *Is the Arena showing the real run?* Yes, it is a replay of saved bots. The source line shows the tag and seed. A `run-dry-…` tag means an offline run.
- *Does the Arena send anything to Flagsmith?* No. It doesn't import the flags adapter.

## 11. `web/src/draw.js` and `web/src/style.css`

They draw a game state on a canvas: walls, see-through ghost walls, the character, and the "Practice" label. Humans and the Arena share them. There is no game logic here.

## 12. `test/`: what the tests prove

Run them with `npm test`.

| File | What it proves |
| --- | --- |
| `engine.test.js` | Same seed and inputs give the same game. `normal` is full difficulty. `gentle_ramp` is wider and slower, then normal from wall 10. **Variants change only the first try.** Practice is harmless for 10 s, first try only, and ghost walls never score. Levels change at 10 and 20 walls. |
| `brain.test.js` | **The brain never reads `mode`, `runIndex` or `ghost`** (Proxy guard). The guard changes nothing. `brain.js` never mentions mode or variant names. Traits depend only on seed and bot number. `observe` returns only on-screen facts. Sessions are reproducible. |
| `flags.test.js` | The dry-run adapter: same bot, same arm. 3,000 bots split roughly evenly. Events carry identifier and value. A/A gives three arms that all play normal. No key means `normal` and no crash. |

**Judge question:** *How do you know the bots don't peek?* Point to `guardedScreen` in `brain.test.js`.

## 13. `scripts/`

- `check-flagsmith.mjs`: "Can we talk to Flagsmith?" It is **read-only** by default: it reads the flag for one test identity and records nothing. `--expose` records one exposure, so only use it before the experiment starts or with `--aa`. It never prints the key.
- `run-tests.mjs`: finds every `test/*.test.js` file and runs it with Node's built-in test runner. Listing the files itself means it works the same on Windows, macOS and Linux.

## 14. Config files

- `package.json`: scripts `dev`, `build`, `preview`, `sim`, `sim:dry`, `test`. Two dependencies, the two Flagsmith SDKs, plus Vite.
- `vite.config.js`: the web root is `web/`, `.env` is read from the project root, and there are two pages: the game and the Arena.
- `vite.config.js` also sets `base` from the `BASE_PATH` variable. Locally it is `/`; the GitHub Pages workflow sets it to `/<repo>/`, because a project site lives in a sub-folder.
- `.github/workflows/ci.yml`: on every push, runs `npm ci`, `npm test`, a 900-bot offline smoke run and `npm run build`. No secrets needed.
- `.github/workflows/pages.yml`: builds the site and publishes `dist/` to GitHub Pages. With no `VITE_FLAGSMITH_CLIENT_KEY` repo variable, the hosted game runs offline.
- `.env.example`: key **names** only: `FLAGSMITH_SERVER_KEY`, `FLAGSMITH_SERVER_KEY_AA`, `VITE_FLAGSMITH_CLIENT_KEY`.
- `.gitignore`: `.env`, `node_modules/`, `dist/`, `runs/*.json`. Saved evidence goes to `docs/results/` instead.

**Judge question:** *Where do keys go?* In `.env`, which git ignores. Nothing in the repo contains a key.

---

## Checklist before publishing

- [ ] Every quoted line still matches the code.
- [ ] Each team member can answer every judge question above without notes.

**Debug diamond.** With `?debug` in the address, the game shows a coloured ♦ instead of the version name: blue = normal, green = gentle_ramp, purple = practice_first (`web/src/main.js`, `start()`).
