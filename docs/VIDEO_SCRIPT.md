# Demo video script (12 shots, target 2:40, hard limit 2:45)

> **Results placeholder.** Every number in `[brackets]` comes from the Flagsmith results page after the **one live run**. Do not record shots 9–12 until the final numbers are on screen. Never say a number that is not on screen. If the result is "not shippable", use the alternate lines.
>
> **Which run is on camera?** Either film the single real live run (`npm run sim -- --bots 4500 --seed <v2 seed>`), or film `npm run sim:dry` with an on-screen label **"Offline dry run"**. **Never** do an extra live run for the camera. Every live bot becomes a real participant in the experiment.

## Shot table

| # | Time | On screen | Voice-over (calm, about 150 words per minute) |
| --- | --- | --- | --- |
| 1 | 0:00–0:06 | **Hook.** Arena view, three lanes: `normal`, `gentle_ramp`, `practice_first`. Bots crash, retry, stamp "LEVEL 3" / "BORED QUIT". Title overlay: "Level Up". | "These players are robots. None of them knows which version of the game it's playing." |
| 2 | 0:06–0:22 | **Problem.** Slide: "Top 25% of mobile games: Day 1 retention just above 30%", source line "GameAnalytics 2026 benchmarks". Cut to a human crash on wall 2. | "Most players who try a new game leave almost at once. Even in the best quarter of mobile games, about seven in ten don't come back the next day. So should the first level be easier? Easier might keep beginners and bore everyone else. We tested it." |
| 3 | 0:22–0:38 | **Three first tries.** Human game with `?debug`, three quick clips: normal, gentle ramp (wide slow walls), practice (ghost walls, "Practice" label). | "This is Kite Fight. One Flagsmith flag decides your first try: normal, a gentle ramp of wide, slow walls, or ten seconds of harmless practice. After that, every retry is the normal game." |
| 4 | 0:38–0:54 | **Flagsmith.** Flag `level1_mode` with variants. Then the experiment: 100% rollout, split evenly, goal `reached_level_3`, guardrails `rage_quit`, `bored_quit`. | "In Flagsmith it's one multivariate flag, level1_mode. The experiment puts every player in, splits them evenly three ways, and measures one goal, reaching Level 3, with two guardrails: rage quits and bored quits." |
| 5 | 0:54–1:08 | **Code: 3 lines.** Editor, zoomed, one line highlighted at a time in `bots/flags.mjs`: `getExperimentFlag`, `trackEvent`, `close`. | "The code is three calls. getExperimentFlag gets the version and records that this player saw it. trackEvent sends what happened. close sends what's left before we exit. The browser game uses the same calls." |
| 6 | 1:08–1:22 | **Honest bots.** `test/brain.test.js` with the Proxy guard highlighted, then `npm test` passing. Caption: "Bots never see the version." | "Each bot gets its reaction time, aim, patience and boredom limit before Flagsmith assigns it. Its brain only sees the screen. If it ever tries to read the version, this test throws." |
| 7 | 1:22–1:27 | **A/A check (5 s).** A/A results: three arms close together, "split check: PASS". | "First, an A/A check: everyone plays normal. No winner. The pipeline is fair." |
| 8 | 1:27–1:45 | **Our wrong guess.** `docs/HYPOTHESIS.md`: v1 hypothesis (gentle ramp), then the change log, then v2, with the GitHub commit time visible. | "Our first guess was gentle ramp. The offline pre-flight said no: it barely helped, and it bored skilled players. We didn't hide that. We kept the first guess, logged every change, and pushed version two to GitHub before the live run. Prediction: practice first wins, and gentle ramp fails the boredom guardrail." |
| 9 | 1:45–1:58 | **The run + Arena.** Terminal: the sim summary table and "split check: PASS", "fallbacks=0". Quick cut to the Arena with full-run rates on top. | "Then the real run: [4,500] robot players, each a Flagsmith identity, playing once. The split is even. In the Arena you can see the difference." |
| 10 | 1:58–2:20 | **Flagsmith results.** Point at `reached_level_3` for `practice_first`: lift, 95% credible interval, chance to beat control. Then the guardrail numbers. | "On reaching Level 3, practice first shows a lift of 28 percent, with a credible interval from plus 18 to plus 37 percent, and a better than 99.9 percent chance to beat control. Bored quits: flat, up just 0.1 points. Gentle ramp: only 3.5 percent, inconclusive, and bored quits up 8 points — 30 percent of skilled players got bored and left." |
| 11 | 2:20–2:32 | **Decision.** v2 decision rule beside the numbers, a tick or cross per line. | *If shippable:* "Our rule, written first: over 95 percent, and no guardrail past its limit. Practice first passes. Gentle ramp fails on boredom. We ship practice first." *If not:* "Our rule says over 95 percent and no guardrail past its limit. [Variant] didn't make it, so normal stays. We read this like a product team, not a scoreboard." |
| 12 | 2:32–2:42 | **Rollout + close.** Flagsmith: End Experiment → roll out `practice_first`. Cut to the browser with `?debug`, refresh twice, new player ids: badge reads `mode: practice_first`. End card: GitHub URL, "Traffic simulated by robot players. Results from Flagsmith Experimentation." | "We end the experiment, and Flagsmith now serves the winner to everyone. No redeploy. Our first guess was wrong. The robots told us before real players did. Level Up. It's all on GitHub." *If not shippable:* choose "Roll out control"; the badge reads `mode: normal`. "We end the experiment and keep normal. Next we test an adaptive first try. Same flag, new variant." |

## Recording tips

- **Tool.** OBS Studio (free) or any screen recorder. **1920×1080, 30 fps**, MP4 (H.264).
- **Zoom in.** Browser and editor at 125–150%. Code must be readable on a laptop.
- **Record in pieces.** One clip per shot. Re-record a shot rather than cutting inside it.
- **No dead air.** Cut loading spinners and waits. Flagsmith results refresh at most once every 5 minutes, so open the results page before recording shot 10.
- **Pre-stage the dashboard.** Have the flag, experiment and results tabs open and logged in. Hide bookmarks. Never show `.env` or a key.
- **Captions.** Burn them in (many judges watch muted). Use the voice-over column as the caption text.
- **Audio.** A headset or phone mic in a quiet room. Record the voice-over separately if live narration is shaky.
- **Cursor.** Turn on cursor highlight. Point at the number you are reading.
- **Honesty line.** "Traffic simulated by robot players" must be on screen at least once (shots 6 and 12). If you film a dry run, label it "Offline dry run" on screen.
- **New player in shot 12.** Use a private window, or clear `levelup_player_id` in localStorage, so each refresh is a new player.
- **Time check.** Read the script aloud with a stopwatch first. If it runs long, trim shot 3 to two clips.
- **Upload.** YouTube (unlisted is fine) or Loom. Put the link at the top of the README.

## Order of work on recording day

1. Check that v2 of `docs/HYPOTHESIS.md` is committed and pushed. Note the commit time.
2. Run the A/A check (separate environment). Screenshot it. End the A/A experiment.
3. Run the live experiment **once**. Film it if you want it on camera.
4. Wait for ingestion, refresh results, save screenshots and JSON to `docs/results/`. Commit and push.
5. Fill every `[bracket]` here and in the README from the same screen.
6. Record shots 1–10. Apply the decision rule, then record shot 11.
7. **Last:** End the experiment and roll out (shot 12). Ending freezes the results and cannot be undone.
