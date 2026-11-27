# Level Up: design

**In one sentence:** we A/B test the first level of a tiny browser game with Flagsmith Experimentation, and let robot players who really play the game tell us which version keeps more players going.

This page describes what we built and why. The hypothesis and decision rule live in [HYPOTHESIS.md](HYPOTHESIS.md). The Flagsmith setup lives in [FLAGSMITH_SETUP.md](FLAGSMITH_SETUP.md). The line-by-line explanation lives in [WALKTHROUGH.md](WALKTHROUGH.md).

---

## 1. The game: "Jumpy"

Jumpy is a Flappy-Bird-style canvas game. A small character falls with gravity. A tap, click or Space makes it flap upward. Walls with a gap scroll in from the right. Touching a wall, the floor or the ceiling is a crash. Passing a wall scores one point.

- **Level 1** = walls 1–10, **Level 2** = walls 11–20, **Level 3** = wall 21 onward.
- **"Reached Level 3"** = passed 20 walls in one try.
- A player can retry many times. Each retry is a new **try** (a "run" in the code). A **session** ends when the player reaches Level 3, quits, or hits the cap of 25 tries.

## 2. The experiment

### One flag, three versions of Level 1

| Flagsmith | Value | What the player gets on the first try |
| --- | --- | --- |
| Control (base value) | `normal` | Full difficulty from wall 1 |
| Variant key `gentle_ramp` | `gentle_ramp` | Walls 1–10 start 50% wider and at 70% speed, easing back to normal by wall 10 |
| Variant key `practice_first` | `practice_first` | 10 seconds of harmless "ghost" walls labelled "Practice" (you bounce off the floor and ceiling, nothing scores), then normal difficulty |

The flag is `level1_mode` (multivariate). 100% of identities enter the experiment, split evenly three ways.

### Both variants change only the first try

Every retry in a session is the normal game, in every arm. We chose this so the two variants give the same "dose": one changed first try each. Without it, `practice_first` would hand out a free practice zone on every retry and `gentle_ramp` would hand out ten easy walls on every retry, and we would be measuring the number of retries as much as the design. A first-try change also matches the real question: what should a brand-new player see first?

### Metrics

Event names are case-sensitive and defined once in `engine/constants.js`.

| Role | Event | Flagsmith aggregation | Good direction |
| --- | --- | --- | --- |
| Goal | `reached_level_3` | Occurrence | Higher |
| Guardrail | `rage_quit` | Occurrence | Lower |
| Guardrail | `bored_quit` | Occurrence | Lower |
| Secondary | `walls_passed` | Mean (best try's walls, sent once per session) | Higher |

The robot players send all four events. The browser game sends `reached_level_3` and `walls_passed` only. A human closing a tab gives us no reliable signal of *why* they left, so we do not guess rage or boredom for humans.

## 3. Honest robot players

The simulated traffic is only worth something if the robots cannot "know" the answer. These are the rules we built to.

- **Each bot is a Flagsmith identity**, `bot-<tag>-<n>`. Live runs get a timestamped tag, so every live run uses new identities, and the simulator refuses to reuse a tag.
- **Traits are drawn once, before assignment,** from fixed distributions that depend only on the seed and the bot number:
  - `reactionMs`: how late it reacts (bell curve around 230 ms, 120–420 ms).
  - `aimNoise`: how imprecise it is, in pixels (median about 14 px, 3–60 px). Small = skilled.
  - `patience`: how many fast crashes in a row it tolerates before rage-quitting (1–5).
  - `boredomThreshold`: how much easy play it tolerates (0.35–0.95).
- **The brain only gets a "screen".** For each try, the brain gets `look()` (height, speed, next gap, score, crashed?, frame count, clearance of the wall just passed) and `tap(flap)`. It never sees the mode, the try number or whether a wall is a ghost. A unit test wraps the game in a Proxy that throws if the brain reads `mode`, `runIndex` or `ghost`.
- **Beginners improve with play.** A new bot aims worse at first, and gets better with every second it plays. This is the same for every arm.
- **Rage comes from crashes.** A "fast crash" is a crash before passing 3 walls. More fast crashes in a row than the bot's `patience` = `rage_quit`.
- **Boredom is skill-relative.** A wall feels easy when the room left between the character and the wall is more than 1.3 × the bot's own `aimNoise`. A precise bot needs less room to feel safe, so the same wide gap bores it sooner. A slow average of "how easy did that feel" above `boredomThreshold` = `bored_quit`. A crash calms boredom down. Because boredom is measured this way, every arm has some bored quits, mostly among skilled bots, so the guardrail can actually be scored.
- **Same engine.** Bots and humans play `engine/`, the same pure game code.
- **Reproducible.** Seeds are fixed and saved in `runs/<tag>.json`. The same seed gives the same games.
- **A/A check.** The whole pipeline runs with every arm playing `normal`. The arms should then differ only by chance.
- **We say it plainly** in the README, the Arena and the video: the traffic is simulated by robot players.

## 4. Code layout

ES modules, Node 20+, Vite for the browser. No other framework.

```
levelup/
  package.json          scripts: dev, build, preview, sim, sim:dry, test
  engine/               pure game logic, no DOM, deterministic given a seed
    constants.js        flag name, modes, event names, level sizes, timestep
    config.js           modeConfig(mode, wallIndex, timeMs) -> { gap, speed, ghost }
    game.js             createGame, step, level, observe, makeScreen
    rng.js              seeded random numbers and seed hashing
  bots/
    brain.js            traits, the flap controller, boredom/rage, playSession
    flags.mjs           Flagsmith Node adapter + offline dry-run adapter
    sim.mjs             runs N bots, sends events, prints summary, split check, sanity check
  web/
    index.html, src/main.js     the game for humans (?debug shows the mode)
    arena.html, src/arena.js    watch 12 bots per version replayed side by side
    src/flags.js                Flagsmith browser adapter
    src/draw.js, src/style.css  drawing and styles
  scripts/
    check-flagsmith.mjs   read-only connection check
    run-tests.mjs         runs every test file
  test/                 engine, brain and dry-run adapter tests
  docs/                 DESIGN, HYPOTHESIS, FLAGSMITH_SETUP, PITCH, VIDEO_SCRIPT, WALKTHROUGH, results/
  .env.example          key names only
```

## 5. Adapter contracts

Both adapters are small on purpose, so the game code does not care whether Flagsmith is there.

`bots/flags.mjs`: `createFlagClient({ dryRun, runTag, aa, flag })` returns:
- `getLevelMode(botId)`: calls `getExperimentFlag` (which records the exposure) and returns `normal`, `gentle_ramp` or `practice_first`. Falls back to `normal` on any problem and counts it as a fallback.
- `track(botId, eventName, value?)`: `trackEvent(eventName, { identifier, value })`.
- `close()`: sends every buffered event before the process exits.
- Dry run: a stable hash of the bot id picks the arm, nothing goes over the network, and events are kept in memory.
- A/A: Flagsmith assigns real arms in a separate environment, but every bot plays `normal`.

`web/src/flags.js`: `initFlags(playerId)`, `getLevelMode()`, `track(eventName, value)`, `flush()`, `isOnline()`. It never throws. With no client key it goes offline and everyone plays `normal`. The player id is a random id kept in `localStorage`.

## 6. Ground rules we kept

- Code is small, readable and commented in plain English.
- No secrets in the repo. Keys live in `.env`, which is git-ignored, and are never printed.
- Everything runs offline with `npm run sim:dry`, without a Flagsmith account.
- Flagsmith's Bayesian engine gives the official result. Our simulator adds a split check and a local sanity check, and is our pre-flight tool.
