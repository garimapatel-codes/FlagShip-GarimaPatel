# Level Up: the pitch

## One line

**We A/B test the first level of a tiny browser game with Flagsmith Experimentation. Robot players who don't know which version they're in showed us that our first guess was wrong, before a single real player had to suffer it.**

Title card: *"One flag. Three first levels. 4,500 robot players. One honest decision."*

## The twist, in two sentences

The "obvious" fix, an easier start (`gentle_ramp`), barely helped and bored skilled players. A 10-second practice zone (`practice_first`) helped more and looked safe, and that is what the live Flagsmith run will test.

> Until the live run is done, every result below is from the **offline dry run**, and we say so. The live Flagsmith run is the official measurement. Update this page with its numbers after the run.

---

## 1. The problem

Most players who try a new game leave almost at once. The first minute decides a lot.

- GameAnalytics' 2026 benchmarks (2025 data) report that the top 25% of mobile games have a Day 1 retention "just above 30%". The industry median Day 7 retention is "just under 4%". So even in the best quarter of games, about 7 in 10 new players do not come back the next day.
  Source: [GameDev Reports summary of the GameAnalytics 2026 benchmarks](https://gamedevreports.substack.com/p/gameanalytics-mobile-and-pc-game)
- The year before (2024 data), Day 1 retention for the weakest 25% of games was only 10 to 11.5%. The top 25% sat at about 26 to 28%.
  Source: [GameDev Reports summary of the GameAnalytics 2025 benchmarks](https://gamedevreports.substack.com/p/gameanalytics-mobile-gaming-benchmarks)
- GameAnalytics' own advice on the first-time experience: "Users should do something fun as soon as they open your mobile game", and "Track every single step in the tutorial and create a funnel to measure the points where users drop off."
  Source: [GameAnalytics: tips for a great FTUE in F2P games](https://gameanalytics.com/blog/tips-for-a-great-first-time-user-experience-ftue-in-f2p-games)

Knowing *that* players leave is the easy part. The hard part is knowing *which fix* keeps them. Make Level 1 easier and beginners may stay, but skilled players may get bored and leave. Teams usually argue about this in a meeting. We think they should test it.

## 2. Why games are a perfect A/B testing playground

- **The outcome is clear.** Did the player reach Level 3 or not? No survey needed.
- **The change is small and safe.** One flag decides how the first try looks.
- **There is a real trade-off.** Easier helps some players and hurts others. That is exactly what guardrail metrics are for.
- **Players can be simulated honestly.** A game has rules. A bot can play by those rules with human-like limits, so we get thousands of real plays in minutes.

## 3. What we built

- **Kite Fight**: a small tap-to-fly canvas game with our own pixel-art kites that humans can play in the browser.
- **One Flagsmith flag, `level1_mode`**, with three values:
  - `normal` (control);
  - `gentle_ramp`: wider, slower walls easing to normal by wall 10;
  - `practice_first`: 10 seconds of harmless ghost walls, then normal.

  Each variant changes **only the first try**. Every retry is the normal game, so both variants get the same "dose".
- **A Flagsmith experiment** on that flag:
  - 100% of identities, split evenly three ways;
  - goal `reached_level_3`;
  - guardrails `rage_quit` and `bored_quit`;
  - secondary `walls_passed`.
- **4,500 robot players**. Each one is a Flagsmith identity with its own reaction time, aim, patience and boredom limit. They play the same engine as humans.
- **A simulator with built-in checks**: an even-split check (chi-square), a local sanity check on the goal, a skilled-vs-others breakdown of bored quits, and a `--sensitivity` mode that reruns with different kinds of player.
- **Arena view**: watch 12 bots per version replay side by side, with the full-run rates on top.
- **`?debug` mode**: adds a badge to the game showing which version this player got. We use it to show the rollout working.
- **A pre-registration with a history**: `docs/HYPOTHESIS.md` keeps v1 (our wrong guess) exactly as written, then a dated change log, then v2, frozen in git before the live run.

## 4. What makes the simulation honest

> **"Our bots don't know which version they're in. They just play."**

- The brain only gets a "screen": `look()` shows what a human sees, and `tap()` flaps. A unit test wraps the game in a Proxy that **throws** if the brain ever reads the mode, the try number or the ghost flag.
- Bot traits are drawn from the seed and the bot number only, before Flagsmith assigns the bot.
- Rage comes from fast crashes in a row. Boredom comes from how much room the bot had at each wall, compared with its own skill. Neither reads the variant.
- Seeds are fixed and logged. Any run can be replayed exactly. The Arena does this.
- **A/A check**: with every arm playing `normal`, the arms differed by at most 3.1 points. In one A/A run, an arm looked like a "loser" by pure chance (z = −1.73). That is why we decide only at the planned size and with a pre-written rule.
- We say it everywhere: **the traffic is simulated by robot players.**

## 5. How we hit each judging criterion

| Criterion | What the judges will see | Where |
| --- | --- | --- |
| **Use of Flagsmith** (flags do real work) | One multivariate flag decides how every player's first try is built. `getExperimentFlag` records exposure, and `trackEvent` sends four metrics. Flagsmith's Bayesian engine gives the official result. The winner is rolled out by ending the experiment and letting the same flag serve it, with no redeploy. `?debug` shows it. | `bots/flags.mjs`, `web/src/flags.js`, `engine/constants.js`, `docs/FLAGSMITH_SETUP.md`, `docs/results/` |
| **Clear hypothesis** | v1 kept as written, a dated change log, and v2 with a named primary comparison, a minimum effect (+10%) and a guardrail prediction. Frozen in git before the live run. | `docs/HYPOTHESIS.md` |
| **Versions behind a flag** | `normal`, `gentle_ramp` and `practice_first` are values of `level1_mode`. The engine reads the mode and nothing else changes. | `engine/config.js`, `engine/game.js` |
| **A metric from real events** | Bots and the browser use the same event names from one constants file | `engine/constants.js`, `bots/sim.mjs`, `web/src/main.js` |
| **Results you can explain** | Lift, credible interval and chance to beat control from Flagsmith, plus our split check and guardrails, then a decision that follows the pre-written rule | README Results, demo video |
| **Impact** | Day 1 drop-off is a real, measured industry problem. A studio can reuse the setup with real players and the same flag, and keep the bots as a pre-flight check. | Sections 1 and 8 |
| **Creativity** | Robot players with human-like flaws as honest, replayable traffic, a pre-flight that caught our own wrong guess, and an Arena to watch it happen | `bots/brain.js`, `web/src/arena.js` |
| **Demo video** | Problem, idea, flag, three lines of code, A/A check, bots, Arena, results, rollout, in under 2:45 | `docs/VIDEO_SCRIPT.md` |

## 6. The twist: our first guess was wrong, and that is the point

Our v1 pre-registration bet on `gentle_ramp`. The idea: make the first walls wider and slower, and more beginners will survive to Level 3.

The dry runs said no. On the offline run with seed 42:

| Offline dry run, seed 42 (4,500 bots) | `normal` | `gentle_ramp` | `practice_first` |
| --- | --- | --- | --- |
| Reached Level 3 | 45.3% | 44.0% (−3%) | 53.1% (+17%) |
| Rage quit | 49.9% | 42.5% | 37.6% |
| Bored quit | 1.5% | 8.5% (+7.0 points) | 1.8% (+0.3 points) |
| Bored quit, skilled bots only | 5.0% | 27.8% | 6.9% |

Why it happens, in plain words:
- `gentle_ramp` makes the first walls so easy that skilled bots feel no challenge, and many quit bored. The beginners it saves from rage are cancelled out by the skilled players it loses.
- `practice_first` lets beginners learn the controls for 10 seconds without crashing. Then the real game starts at full difficulty, so skilled players are never bored.

We did **not** quietly change v1. We kept it, logged what changed and why, and wrote v2 before the live run: `practice_first` vs `normal` is the primary comparison, and we predict `gentle_ramp` fails the bored-quit guardrail.

> **"Our first guess was wrong. The robots told us before real players did. That's the point of a pre-flight test."**

That is how a product team reads results: not "which number is biggest", but "did the goal move, did anything get worse, was the split fair, and does this follow the rule we wrote first?"

## 7. Questions judges may ask

**"Isn't simulated traffic fake?"**
The players are simulated. The experiment is not. Every bot is a real Flagsmith identity, assigned by Flagsmith's real bucketing, sending real events that Flagsmith's stats engine analyses. Bots don't know their variant, and a test proves the brain never reads it. What bots can't tell you is how *real* people feel, and we say so in our limitations.

**"You changed the hypothesis after the dry runs. Isn't that cheating?"**
It would be if we hid it. We kept v1 word for word, dated every change, and explained why each one was made: a fair first-try dose for both variants, and a boredom rule that can actually be scored. We also froze v2 in a public git commit before the live run. The live run uses fresh identities and a new seed. The dry runs are our pre-flight. The live Flagsmith run is the measurement.

**"Didn't you build `practice_first` to win?"**
Fair worry. One honest answer: our bots learn from time played, so a crash-free practice zone gives beginners about 10 seconds of free learning. That assumption is in `bots/brain.js`, in the open, and listed as a limitation. Real players might learn less from ghost walls. The sensitivity runs show the direction holds for more-skilled and less-patient populations too (+17% and +30%), but a real studio would confirm with real players.

**"Why Bayesian?"**
Because "97% chance to beat control" means what it sounds like. A p-value is easy to misread. Flagsmith's docs also note that Bayesian results are safe to check as data arrives. We still fixed the sample size and the rule in advance.

**"How do you know the split was fair?"**
The simulator runs a chi-square split check on every run and prints PASS or FAIL. Flagsmith also has a sample ratio mismatch check. In our setup that check may not run (see `FLAGSMITH_SETUP.md`), so we don't rely on it alone.

**"What does your local z-test add, if Flagsmith is the official result?"**
It's a sanity check. If our quick number and Flagsmith's number disagree a lot, something in the pipeline is broken, for example events that were never delivered.

**"Why 4,500 bots?"**
We sized it before running: about 1,500 per arm gives about 77% power for a +10% lift and about 97% for +15%. We do one live run, once. More live runs would add identities to the real experiment.

**"What would you test next?"**
An adaptive first try: practice zone for beginners, skipped for anyone who clears the first walls cleanly. It's the same flag with a new variant.

**"How would a real studio use this?"**
Keep the flag, the event names, the metrics, the experiment and the decision rule. Point real players at it. Keep the bots as the pre-flight check. See the next section.

## 8. How a real game team would reuse this

1. **Use it as a template.** One multivariate flag for the thing you're unsure about, one constants file for event names, one pre-registration page with a change log.
2. **Run the bots first.** Before spending real players, run the pre-flight. It catches broken variants, missing events and wrong guesses, like ours.
3. **Plug in real players.** In the browser, `initFlags(playerId)` identifies the player and `getLevelMode()` records the exposure. The game already sends `reached_level_3` and `walls_passed`. A studio would add its own quit signals, for example from session length.
4. **Keep the same flag.** The game code doesn't change between "test" and "launch". When the experiment ends with a winner, Flagsmith serves that variant to everyone. No redeploy.
5. **Grow it.** Use the same approach for the shop price, the tutorial text, or the reward after Level 1. One flag per question.

## 9. Three lines to remember

1. "Our bots don't know which version they're in. They just play."
2. "Our first guess was wrong. The robots told us before real players did."
3. "To ship the winner, we didn't redeploy. We ended the experiment, and the same flag now serves it to everyone."
