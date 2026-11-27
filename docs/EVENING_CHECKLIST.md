# Tonight's checklist

**Deadline: 8:00 PM IST, Sunday 29 November 2026.** Aim to finish steps 1–7 tonight; the rest can wait for tomorrow if the Flagsmith results are still loading.

Commands are for **Windows PowerShell**, run from inside the `levelup` folder. Replace `<you>` with your GitHub username. Tick each box as you go.

## Part 1: Freeze v2 on GitHub (before any live run)

- [ ] **1. Create an empty GitHub repo.** github.com → **New repository** → name `levelup` → **Public** → do **not** add a README, .gitignore or licence (we already have them) → **Create**.
- [ ] **2. Delete the planning files** (only if they are in your folder; they must not go on GitHub):
  ```powershell
  Remove-Item SPEC.md, docs\WALKTHROUGH_PLAN.md -ErrorAction SilentlyContinue
  ```
- [ ] **3. Check that tests pass:**
  ```powershell
  npm install
  npm test
  ```
- [ ] **4. Make the "v2 pre-registration" commit:**
  ```powershell
  git init
  git branch -M main
  git add .
  git status          # .env, node_modules\ and dist\ must NOT be in the list
  git commit -m "v2 pre-registration"
  ```
  If `git commit` asks who you are, run `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`, then commit again.
- [ ] **5. Push it:**
  ```powershell
  git remote add origin https://github.com/<you>/levelup.git
  git push -u origin main
  ```
- [ ] **6. Write the v2 commit hash into the change log.** Get the hash:
  ```powershell
  git rev-parse --short HEAD
  ```
  In `docs/HYPOTHESIS.md`, replace `<date>` and `<hash>` in the "v2 frozen" change-log row (and `<hash>` under the v2 heading) with today's date and that hash. Then:
  ```powershell
  git add docs/HYPOTHESIS.md
  git commit -m "Record v2 commit hash"
  git push
  ```
  From now on, **do not edit the v2 text** in `HYPOTHESIS.md`.
- [ ] **7. Check GitHub.** Open the repo page: the files are there, and the **Actions** tab shows a green tick for "CI" (tests + 900-bot smoke run + build). "Deploy to GitHub Pages" will show a red cross until you turn Pages on in step 14. That is normal.

## Part 2: The experiment (one live run only)

- [ ] **8. Set up Flagsmith.** Follow [FLAGSMITH_SETUP.md](FLAGSMITH_SETUP.md), section **"Fast path"**. Create `.env` from the example and paste in the keys:
  ```powershell
  Copy-Item .env.example .env
  notepad .env
  node scripts/check-flagsmith.mjs
  ```
- [ ] **9. A/A check** (separate environment; everyone plays `normal`):
  ```powershell
  npm run sim -- --aa --bots 1500 --seed 1
  ```
  Expect "split check: PASS" and no clear winner in Flagsmith. Save the A/A evidence in `docs/results/`, then **end the A/A experiment** before step 10.
- [ ] **10. The ONE live run** (start the Production experiment first):
  ```powershell
  npm run sim -- --bots 4500 --seed 2026
  ```
  Do not run it again, not even for the video. Check the output says "split check: PASS" and "fallbacks=0".
- [ ] **11. Fetch the results** once Flagsmith has refreshed (it can take a while; refresh at most every 5 minutes). Use `scripts/fetch-results.mjs` as described in [FLAGSMITH_SETUP.md](FLAGSMITH_SETUP.md). You need `docs/results/results-final.json` and `docs/results/exposures-final.json`.
- [ ] **12. Fill in the README results.** In `README.md`, section "Live Flagsmith results (official)": every `< >` and empty cell, the decision (apply the rule exactly as written), H1/H2 and the next test. Copy numbers from the Flagsmith page, never from memory.
- [ ] **13. Screenshots.** Flagsmith results page and exposures panel → save as `docs/results/results.png` (plus any others) and link `results.png` in the README. Never show a key or `.env` in a screenshot.
  ```powershell
  git add docs/results README.md
  git commit -m "Live results"
  git push
  ```

## Part 3: Show it off

- [ ] **14. Turn on free hosting (GitHub Pages).** Repo → **Settings → Pages → Source: GitHub Actions**. Then **Actions → "Deploy to GitHub Pages" → Run workflow**. After about a minute the game is at `https://<you>.github.io/levelup/` and the Arena at `https://<you>.github.io/levelup/arena.html`. Put the link in "Play it online" at the top of the README.
  - It runs **offline** (everyone plays `normal`). That is fine. If you want the hosted game connected to Flagsmith, add the repo **variable** `VITE_FLAGSMITH_CLIENT_KEY` (Settings → Secrets and variables → Actions → Variables) **only after the experiment has ended**, so visitors don't join the official run. Use the client-side key, never the `ser.` key.
- [ ] **15. Record the video.** Follow [VIDEO_SCRIPT.md](VIDEO_SCRIPT.md) (under 2:45, captions on, "Traffic simulated by robot players" on screen). Do the rollout shot (End experiment → roll out) **last**. Upload to YouTube (unlisted is fine) and put the link at the top of the README.
- [ ] **16. Final push and submit.** Fill in team names in the README and `LICENSE`, tick the "Before submitting" list in the README, then:
  ```powershell
  git add .
  git status          # still no .env!
  git commit -m "Submission"
  git push
  ```
  Submit the repo link and video link on the hackathon page **before 8:00 PM IST, Sunday 29 November**.
