# Pre-registration: the Level 1 experiment

This page has three parts, in the order they happened:

1. **v1**: our first pre-registration, written 24 November 2026. Kept exactly as written. It bet on `gentle_ramp`.
2. **Change log**: what we changed in the bot model and the engine after an independent review, and what our offline dry runs showed.
3. **v2**: the final pre-registration for the live Flagsmith run. It is frozen by a git commit pushed to GitHub **before** the live run.

We did not rewrite v1 to match the data. Changing a hypothesis after seeing results and presenting it as the original is called HARKing ("hypothesising after the results are known"). It makes any experiment look right. So v1 stays here, wrong guess and all.

> **The simulator is our pre-flight tool; its dry runs informed v2. The live Flagsmith run with fresh identities is the official measurement.**

---

## Part 1: v1 (written 24 November 2026). Kept unchanged

*Status: superseded by v2 for the live run. The text below is exactly as written for v1, with headings moved down one level to fit this page. Some details here no longer match the code (see the change log), and v1's "600-bot live demonstration" was dropped: a second live run would add identities to the real experiment.*

**Written:** 24 November 2026, before any experiment run.
**Rule:** Nothing on this page changes after the first real run. If we change our minds, we add a dated note at the bottom and say why.

### 1. The question

New players who crash a lot in the first minute often never come back.
Does an easier start keep more new players playing long enough to reach Level 3 of "Jumpy"?
And does it cost us anything with players who are already good?

### 2. The hypothesis

> An easier start (`gentle_ramp`) will increase the share of new players who reach Level 3 by at least 15% versus `normal`, without increasing bored quits by more than 2 points.

`practice_first` is a third arm. We expect it to help too, but we make no formal claim about it. We report it either way.

### 3. What we change: one flag

| Item | Value |
| --- | --- |
| Flagsmith flag | `level1_mode` (multivariate) |
| Control | base value `normal`: full difficulty from wall 1 |
| Variant `gentle_ramp` | Level 1 walls start with a wider gap and slower speed, easing to normal by wall 10 |
| Variant `practice_first` | a 10-second ghost "Practice" zone (walls pass through you), then normal difficulty |
| Rollout | 100% of identities enter the experiment |
| Split | even, three ways (about 33/33/33) |
| Exposure | recorded by `getExperimentFlag('level1_mode', …)` once per player, at the moment the level is built |

Every level after Level 1 is the same in all three arms. Only the first 10 walls differ.

### 4. Metrics

Event names are case-sensitive. They live in one place: `engine/constants.js`. The game and the bots both import them, so a typo cannot split the data.

| Role | Event name | Flagsmith aggregation | Good direction | When it is sent |
| --- | --- | --- | --- | --- |
| **Primary (goal)** | `reached_level_3` | Occurrence | Higher is better | Player passes wall 20 in one run |
| Guardrail | `rage_quit` | Occurrence | Lower is better | Player quits after a streak of fast crashes |
| Guardrail | `bored_quit` | Occurrence | Lower is better | Player quits because the game felt too easy for their skill |
| Secondary | `walls_passed` | Mean (numeric `value`) | Higher is better | Once per session, value = best run's walls |

A session ends when the player reaches Level 3, quits, or hits the 25-run cap.

### 5. Decision rule (fixed now, before results)

We read the Flagsmith results page and apply these rules in order.

1. **Health check first.** If our split check fails (chi-square on per-arm exposure counts, p < 0.001), Flagsmith shows a sample ratio mismatch warning, or any arm still says "Collecting data", we do not decide. We fix the pipeline and rerun.
2. **Ship `gentle_ramp`** only if both hold:
   - its **chance to beat control is above 95%** on `reached_level_3`, and
   - neither guardrail is significantly worse: Flagsmith does not mark `rage_quit` or `bored_quit` as losing for that variant, **and** the absolute rise in the `bored_quit` rate is no more than 2 percentage points.
3. **Same rule for `practice_first`.** If both variants pass, we pick the one with the higher `reached_level_3` rate, and say so.
4. **Otherwise keep `normal`** (control). If a variant wins the goal but fails a guardrail, we call it "promising but not shippable" and name the next experiment.
5. **About the "15%" in the hypothesis.** The ship rule is about confidence, not size. Separately, we say whether the measured lift reached 15%, and whether the 95% credible interval sits above +15%, above 0, or crosses 0. A ship with a smaller lift is a valid result that partly rejects our hypothesis. We will say that plainly.

Why 2 points and not a percentage: Flagsmith reports lift as a relative change. A bored-quit rate going from 2% to 3% is "+50%" but only 1 point. Points match how a game designer thinks about it, so we check them from the same events (the sim summary prints both).

### 6. Sample size plan

The simulator is cheap, so we size the run to actually answer the question.

To detect a 15% relative lift with about 80% power at a one-sided 5% level (close to the "95% chance to beat control" bar), we need roughly this many players **per arm**:

| `reached_level_3` rate in control | Players per arm |
| --- | --- |
| 20% | ~2,300 |
| 30% | ~1,350 |
| 40% | ~850 |
| 50% | ~550 |

(Standard two-proportion formula. It is a planning guide, not the Bayesian test itself.)

Plan:

1. **Dry run** (`npm run sim:dry`, offline) with 1,000 bots to measure the control rate.
2. Pick N per arm from the table above using that rate. Default if unsure: **1,500 per arm (4,500 bots)**.
3. Flagsmith's floor (50 identities and 5 conversions per arm) is far below this, so it will not block us.
4. One run, one decision. We do not keep adding bots until a number looks good. (Bayesian results are safe to look at early, but we still decide only at the planned N.)

The 600-bot run in the demo video is a short live demonstration. The decision uses the planned run.

### 7. How the simulation stays honest

Simulated traffic is allowed in this track. Here is why our robot players can be trusted to tell us something.

- **Bots do not know their variant.** Each bot asks Flagsmith for `level1_mode` and passes the answer to the game engine. The bot's brain never sees it. It only sees what a human sees: its height, its speed, and where the next gap is.
- **Same engine for bots and humans.** `engine/` runs both the browser game and the headless bots. There is no special "bot version" of the game.
- **Traits are drawn once, from fixed distributions that do not depend on the variant.** `reactionMs` (how late it reacts), `aimNoise` (how imprecise), `patience` (fast crashes it will take before rage-quitting), `boredomThreshold` (how much easy play it tolerates). A bot gets its traits before Flagsmith assigns it.
- **Feelings come from the game, not the label.** Frustration is computed from crash timing. Boredom is computed from measured challenge (how close the bot came to the walls). Nothing reads the variant name.
- **Fixed, logged seeds.** Each run has a `runTag`. Bot ids are `bot-<runTag>-<n>`. Seeds are written to `runs/<tag>.json`, so anyone can replay a run and get the same games.
- **A/A check first.** Before the real run, we run the full pipeline with every arm playing `normal`. All arms should look the same (no winner, even split). If the A/A run "finds" a winner, the pipeline is biased and we stop.
- **Fresh identities per run.** A new `runTag` means new identities, so no bot carries over between runs and no bot can be counted in two variants.

### 8. Known limitations

We list these up front, so nobody has to find them for us.

1. **Bots are a model of people, not people.** The result tells us how this design behaves for players with these traits. It does not prove real humans behave the same way. The value of the project is the pipeline; a real studio swaps the bots for players and keeps everything else.
2. **We chose the trait distributions.** A different mix of skill levels could change the answer. We publish the distributions in `bots/brain.js` so anyone can change them and rerun.
3. **The A/A check proves the pipeline is fair, not that the bots are realistic.** Those are two different claims.
4. **Three arms, two comparisons.** Each variant is compared to control. With two chances to win, a false winner is a little more likely than with one. Our large sample keeps this risk small, and we report both arms.
5. **"Reached Level 3" is a short-term metric.** Real studios care about Day 1 and Day 7 retention. Our bots play one session, so we use a session-level proxy.
6. **Guardrail thresholds are our choice.** "2 points" of bored quits is a judgement call, made before the data, and written here.
7. **Events are delivered at least once.** Flagsmith's docs say a retried delivery can store an event twice, which can slightly inflate Count, Sum and Mean metrics. Our goal and guardrails are Occurrence metrics, which are not affected. `walls_passed` (Mean) could be slightly affected, which is one reason it is only secondary.

---

## Part 2: Change log

| Date | What changed | Why |
| --- | --- | --- |
| 24 Nov 2026 | v1 written | First pre-registration |
| 24 Nov 2026 | v1 health-check wording edited to add our own split check (chi-square on exposures, p < 0.001). Made after the first offline dry runs existed. | Flagsmith's own SRM warning may not appear in our set-up, so we added a check we control. It changes no prediction. |
| 24 Nov 2026 | **Both variants now apply only to the first try of a session.** Every retry is the normal game in all arms (`engine/game.js`, `currentConfig`). | **Fairness.** Before, `practice_first` gave a free practice zone on *every* retry and `gentle_ramp` gave ten easy walls on every retry. The "dose" then depended on how often a bot crashed, which is not the design we meant to test. Now each variant gives exactly one changed first try. |
| 24 Nov 2026 | **Boredom is now skill-relative.** A wall feels easy when the room left is more than 1.3 × the bot's own `aimNoise` (`bots/brain.js`, `easiness`). | **So the guardrail can be scored.** Before, almost no bot got bored in any arm, so `bored_quit` could not tell the versions apart. Now every arm has some bored quits, mostly among skilled bots. That matches the real worry: an easy start bores good players. |
| 24 Nov 2026 | **The brain only sees a "screen"** (`look()` and `tap()`). A test throws if it reads `mode`, `runIndex` or `ghost` (`test/brain.test.js`). | **Honesty.** Shows in code, not just in words, that bots do not know their variant. |
| 24 Nov 2026 | **The simulator now prints a split check** (chi-square), a **local sanity check** (two-proportion z-test with an approximate chance to beat control), and a skilled-vs-others bored-quit breakdown. It has a `--sensitivity` mode, and live runs get timestamped tags. | **Checking our own pipeline** before spending the one live run. |
| 24 Nov 2026 | **Offline dry runs done**: 4,500 bots on seeds 42, 1 and 7, plus A/A runs and sensitivity runs. Results below. | Pre-flight test of the new model. **No live Flagsmith run has been done under v1 or v2.** |
| 27 Nov 2026 | **v2 frozen** in git commit `aeda50c`, pushed to GitHub before the live run. | Final pre-registration. |

### What the dry runs showed (offline, not the official result)

These are 4,500-bot runs, about 1,500 per arm. "P(beat)" is our local sanity-check approximation, not Flagsmith's number.

| Seed | `normal` reached L3 | `gentle_ramp` reached L3 | `practice_first` reached L3 |
| --- | --- | --- | --- |
| 42 | 45.3% | 44.0% (−3%, P(beat) 23%) | 53.1% (+17%, z = 4.25) |
| 1 | 41.8% | 44.5% | 52.8% |
| 7 | 42.5% | 43.2% | 53.8% |

Across the three seeds, `gentle_ramp` landed between −3% and +7% relative, with P(beat) between 23% and 94%. `practice_first` landed between +17% and +27%, with z between 4.3 and 6.1.

- **Bored quits:** about 1.5% for `normal`, about 8.3% for `gentle_ramp` (about +7 points), and about 1.6% for `practice_first`. On seed 42, `gentle_ramp`'s bored quits were 27.8% among skilled bots and 1.8% among the rest.
- **Rage quits:** about 51% for `normal`, about 43% for `gentle_ramp`, and about 38% for `practice_first`.
- **A/A runs** (every arm plays `normal`): the differences between arms stayed within ±3.1 points. On seed 1, `practice_first` came out 3.1 points lower by pure chance (z = −1.73, approximate P(beat) 4%). That shows chance alone can make an arm look like a loser. It is why we decide only at the planned sample size, with a rule written in advance. All split checks passed.
- **Sensitivity** (seed 42, three kinds of player): `practice_first` won with the baseline, "more skilled" and "less patient" populations (+17%, +17%, +30%). `gentle_ramp` flipped between better and worse (−3%, −10%, +5%), and it always had about 5× the bored quits of `normal`.

**Plainly: in the simulator, our v1 guess was wrong.** The "obvious" fix, `gentle_ramp`, barely helped and bored skilled players. `practice_first` helped and looked safe. Catching this before real players do is what a pre-flight test is for.

---

## Part 3: v2, final pre-registration for the live Flagsmith run

*Written 24 November 2026. Frozen by git commit `<hash>`, pushed before the live run. Not edited after that commit.*

### Primary comparison

**`practice_first` vs `normal`, on `reached_level_3`.**

### Hypotheses (v2)

> **H1 (primary).** A 10-second practice zone on the first try (`practice_first`) will increase the share of players who reach Level 3, compared with `normal`, by at least 10% relative. It will do this without raising bored quits by more than 2 percentage points and without raising rage quits.

> **H2 (guardrail prediction).** `gentle_ramp` will fail the `bored_quit` guardrail: its bored-quit rate will be more than 2 percentage points above `normal`. We expect its effect on `reached_level_3` to be small and uncertain.

Why 10% and not the dry-run figure: the dry runs gave +17% to +27%. A lower minimum leaves room for the live assignment and the new bot sample to differ from the offline runs. We still report the measured lift and its interval.

### Setup (as in the code)

| Item | Value |
| --- | --- |
| Flag | `level1_mode` (multivariate) |
| Control | base value `normal` |
| Variants | `gentle_ramp`, `practice_first` (each has a key) |
| Rollout | 100% of identities, split evenly three ways |
| Exposure | `getExperimentFlag('level1_mode', botId)` once per bot, before it plays |
| Dose | the variant applies to the first try only; retries are normal in every arm |

### Metrics (unchanged)

| Role | Event name | Aggregation | Expected direction in Flagsmith |
| --- | --- | --- | --- |
| Goal (primary, attached first) | `reached_level_3` | Occurrence | increase |
| Guardrail | `rage_quit` | Occurrence | not_increase |
| Guardrail | `bored_quit` | Occurrence | not_increase |
| Secondary | `walls_passed` | Mean | increase |

### Decision rule (same substance as v1)

We apply these steps in order, to each variant against `normal`:

1. **Health.** All of these must hold, or we do not decide:
   - the sim's split check passes (chi-square, p ≥ 0.001);
   - `fallbacks = 0`;
   - Flagsmith shows no SRM warning;
   - no arm says "Collecting data".

   If one fails, we fix the cause and rerun with fresh identities.
2. **Goal.** Flagsmith's chance to beat control on `reached_level_3` is **above 95%**.
3. **Guardrails.**
   - `bored_quit` is up by **no more than 2 percentage points** (absolute, from the per-arm rates).
   - `rage_quit` is **not worse**: Flagsmith does not mark it as losing, and its credible interval does not sit fully on the bad side.
4. **Ship** a variant only if steps 1, 2 and 3 all pass. If both variants pass, ship the one with the higher `reached_level_3` rate.
5. **Otherwise keep `normal`.** A variant that wins the goal but fails a guardrail is "promising but not shippable".

**How we score H1:**
- **Confirmed** if `practice_first` passes the decision rule **and** its measured lift is at least +10%.
- **Partly confirmed** if it ships with a smaller lift.
- **Rejected** if it does not ship.

**How we score H2:** confirmed if `gentle_ramp`'s bored-quit rate is more than 2 points above `normal`'s.

**Where the numbers come from:**
- Flagsmith's results page, and the results JSON saved in `docs/results/`, is the official source for lift, credible interval and chance to beat control.
- If Flagsmith shows guardrail results, we use them.
- If the dashboard shows only the primary metric, we read the guardrails from the results JSON. We use the sim summary of the same run as a cross-check.

### Run plan

1. **A/A check** in the separate A/A environment: `npm run sim -- --aa --bots 1500`. It passes if the split is even and there is no winner. Then end the A/A experiment.
2. **One live run** in Production: 4,500 bots (about 1,500 per arm), **once**. The live run gets a new timestamped tag, so every identity is fresh. No smaller "test" live runs, and no second run for the camera.
3. **Seed.** The live run uses a seed **not used in any dry run**, for example `npm run sim -- --bots 4500 --seed 2026`. That makes the bot personalities a new sample too, not the same 4,500 bots that informed v2.
4. Wait for ingestion and refresh the results. Save screenshots and JSON to `docs/results/`, then commit and push.
5. Apply the decision rule. Only then end the experiment and roll out.

### Power

Suppose about 43% of `normal` players reach Level 3, with 1,500 bots per arm. Then we have about 77% power to detect a +10% relative lift, and about 97% power for +15%. (Two-proportion approximation, one-sided 5%.) The dry-run effect of +17% to +27% is well within what this run can detect.

---

## How the simulation stays honest (current model)

- **Bots do not know their variant.** The brain gets a "screen" for each try. `look()` returns the bot's height and speed, the next gap, the score, whether it crashed, the frame count, and the clearance of the wall just passed. `tap()` advances one frame. One test wraps the game in a Proxy that throws if the brain reads `mode`, `runIndex` or `ghost`. Another test checks that `brain.js` never even mentions them.
- **Same engine for bots and humans.** `engine/` runs both.
- **Traits do not depend on the variant.** `reactionMs`, `aimNoise`, `patience` and `boredomThreshold` come from the seed and the bot number only. They are drawn before Flagsmith assigns the bot.
- **Feelings come from play.** Rage means more fast crashes in a row than the bot's patience allows. Boredom is a running average of how easy each passed wall felt, compared with the bot's own skill.
- **Fixed, logged seeds.** Every run is saved in `runs/<tag>.json` and can be replayed exactly. The Arena does this.
- **A/A check first**, in a separate Flagsmith environment, so its data never mixes with the real experiment.
- **Fresh identities per live run.** The simulator refuses to reuse a live tag.

## Known limitations (current)

1. **Bots are a model of people, not people.** The result shows how this design behaves for players with these traits. It does not prove real humans behave the same way.
2. **The model's assumptions shape the answer.** Bots learn from *time played*, including time in the practice zone. So a crash-free practice zone gives a beginner about 10 seconds of learning for free, and that is a big part of why `practice_first` does well. Real players may learn less from ghost walls.
3. **We chose the trait distributions and the boredom rule.** The sensitivity runs show the direction holds for three populations, but not for every possible one. All the numbers are in `bots/brain.js`, so anyone can change them and rerun.
4. **The model changed after review, and v2 was informed by dry runs.** That is why v1 is kept, the change log is dated, v2 is frozen in git before the live run, and the live run uses fresh identities and a new seed.
5. **The A/A check proves the pipeline is fair, not that the bots are realistic.** These are two different claims.
6. **Two comparisons against one control.** Two chances to "win" make a false winner a bit more likely. The A/A seed-1 result shows what a chance swing looks like. Naming the primary comparison in advance (H1) limits this.
7. **"Reached Level 3" is a one-session proxy.** Real studios care about Day 1 and Day 7 retention.
8. **Guardrail thresholds are judgement calls.** They were made before the live data and are written here.
9. **Humans send fewer events.** The browser game sends `reached_level_3` and `walls_passed` only. Rage and bored quits are measured for bots only.
10. **Events are delivered at least once.** Flagsmith's docs note that a retried delivery can store an event twice, which can slightly inflate Count, Sum and Mean metrics. Our goal and guardrails are Occurrence metrics, so they are not affected. `walls_passed` (Mean) could be, which is one reason it is only secondary.
11. **Flagsmith's SRM check may not run in this setup** (see `docs/FLAGSMITH_SETUP.md`, Part D). So we also check the split ourselves.

## Part 4: Outcome of the live run (added 27 Nov 2026, after the run)

Nothing above was changed after the run. Live run: 4,500 robots, `--seed 2026`, Flagsmith experiment "Level 1 difficulty", results as of 2026-11-27 13:12 UTC (`docs/results/results-final.json`).

- **H1 confirmed.** `practice_first` vs `normal` on `reached_level_3`: 55.2% vs 43.1%, lift +28.0%, 95% credible interval [+18.5%, +37.4%], chance to beat control > 99.9%. Bored quits +0.1 points; rage quits −16.6 points.
- **H2 confirmed.** `gentle_ramp`: `reached_level_3` lift +3.5% (interval [−5.0%, +11.9%], 79.0%, inconclusive); bored quits 9.5% vs 1.4% (+8.1 points), over the 2-point guardrail.
- **Health.** A/A check passed. Split check PASS (p = 0.449). Fallbacks 0. 66 bots in the A/A run reached Flagsmith before that experiment was live and were never enrolled; they did not affect any result.
- **Decision:** ship `practice_first`.


## Part 5: Exploratory add-on — real human players (written 27 Nov 2026, before any human data)

This is **not** part of the v2 decision. The robot run above is the primary result. We add a small human experiment because real players are the final test of any game change.

- **Where:** a separate Flagsmith experiment, "Level 1 real players", in the Development environment, started only after the A/A experiment there had ended. Production and its official result are untouched.
- **Who:** friends and classmates who open the shared game link. Each browser gets a random ID stored on that device.
- **Same flag, same versions, same metrics:** `level1_mode` (normal / gentle_ramp / practice_first); goal `reached_level_3`.
- **Prediction:** practice_first will raise the share of players who reach Level 3 versus normal. With likely tens of players, not thousands, we **expect the result to be inconclusive** and will report it as it comes, without changing any rule.
- **Limits:** humans only send `reached_level_3` and `walls_passed` (rage and bored quits are robot-only); a player who clears browser storage counts as a new player.
- **Change log (27 Nov 2026, before sharing the link):** the game's look was redrawn as "Kite Fight" (our own pixel-art kites). Only drawing code changed; the engine and bot files are byte-identical (checked by SHA-256). One player (a team member) had played the old look before the change. The new look is the same for all three versions.
