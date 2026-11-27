# Flagsmith setup for Level Up

This guide goes from "no account" to "winner rolled out". It covers two experiments:

- the **real experiment**, in the **Production** environment;
- the **A/A check**, in a separate environment. Every arm plays `normal`, and it shows the pipeline is fair.

Each step gives the **dashboard click-path** first, then the **CLI / API** way where one exists.

> Experimentation is a **beta** feature in Flagsmith. The dashboard may look slightly different from the descriptions here. Where this guide could not check something against the docs or the CLI, it says **(unverified)**.

---

## Fast path (scripts)

Two scripts replace most of the dashboard clicks in Parts A4–A6, B, C1 and D. The manual steps further down still work and are the **fallback** if a script fails.

**Still done by hand (once):** create the account, project and the two environments (A1), connect the warehouse (A2), and copy the keys (A3). Then add the Admin API settings to `.env` (see `.env.example`):

| Variable | Where to find it |
|---|---|
| `FLAGSMITH_ADMIN_API_KEY` | Organisation name (top bar) › Organisation Settings › **API Access** › Create API Key. Leave "Is admin" on. Secret. |
| `FLAGSMITH_ENVIRONMENT_KEY` | Production › Environment Settings › Keys: the **client-side** key (Environment ID), **not** `ser.…`. May stay empty: then `VITE_FLAGSMITH_CLIENT_KEY` is used. |
| `FLAGSMITH_ENVIRONMENT_KEY_AA` | Same, in the AA Check environment. |
| `FLAGSMITH_PROJECT_ID` | Optional. The number after `/project/` in the dashboard URL. Only used as a cross-check. |
| `FLAGSMITH_API_URL` | Optional. Leave empty for Flagsmith Cloud. |

**Tonight, in this order:**

```bash
# 0. See every request the setup would send. Sends nothing, needs no keys.
node scripts/setup-flagsmith.mjs --dry-print

# 1. Create flag + variants + 4 metrics + experiment in BOTH environments. Nothing is started yet.
node scripts/setup-flagsmith.mjs
node scripts/setup-flagsmith.mjs --aa

# 2. Freeze the plan in git and push (see "Order of operations", step 2).

# 3. A/A check
node scripts/setup-flagsmith.mjs --aa --start
node scripts/check-flagsmith.mjs --aa                    # expect enrolled = true
npm run sim -- --aa --bots 1500 --seed 1
# wait about 2 minutes
node scripts/fetch-results.mjs --label aa --refresh      # saves docs/results/*-aa.json, prints the table
# then End the A/A experiment in the dashboard: "Roll out control" (Part B, step 8)

# 4. The real experiment, once
node scripts/setup-flagsmith.mjs --start
node scripts/check-flagsmith.mjs                         # read-only, expect enrolled = true
npm run sim -- --bots 4500 --seed 2026
# wait about 2 minutes
node scripts/fetch-results.mjs --label final --refresh   # saves docs/results/*-final.json, prints the README table
git add docs/results && git commit -m "Final experiment results" && git push

# 5. Decide with the rule in docs/HYPOTHESIS.md, then Part E (end experiment, roll out) in the dashboard.
```

**What the scripts do.**

- `setup-flagsmith.mjs` checks first, then creates only what is missing, so it is safe to run again. It creates the multivariate flag `level1_mode` (base value `normal`, enabled), the variants `gentle_ramp` and `practice_first` (key = value, weight 0), the 4 metrics from step 5, and an experiment with the v2 H1 text read from `docs/HYPOTHESIS.md`, 100% traffic, an even split (33.33 / 33.33, control gets 33.34) and all 4 metrics, `reached_level_3` first. The experiment is created **switched off**, like the dashboard wizard does. Only `--start` starts it. Other options: `--aa` (same as `--env-key-var FLAGSMITH_ENVIRONMENT_KEY_AA`), `--env-key-var NAME`, `--name "..."`. For the A/A environment the hypothesis text is an A/A statement, not H1.
- `fetch-results.mjs --label final|aa` finds the experiment on `level1_mode`, saves `results-<label>.json`, `exposures-<label>.json` and `experiment-<label>.json` in `docs/results/`, and prints a health line (exposures per arm, our chi-square split check, Flagsmith's SRM p-value) and a table. The table has, per metric and arm: identities, rate or mean, lift, 95% credible interval, chance to beat control, and a verdict **hint** from the v2 rule. Paste it into README's "Live Flagsmith results". `--refresh` asks Flagsmith to recompute first and waits up to 2 minutes. Flagsmith allows one refresh per **5 minutes**. If it refuses, the script says so and saves the latest stored numbers. `--from-saved` re-prints the table from the saved files without any network.
- Neither script prints a key. Any HTTP error stops the script with the status code and Flagsmith's own message.
- They **do not** end experiments or roll out a winner. That is a human decision (Part E).

**Checked against the Flagsmith source** (`github.com/Flagsmith/flagsmith`, folder `api/`):
- `Authorization: Api-Key <key>` (`api_keys/authentication.py`; docs `management-api/authentication.md`).
- The environment in `environments/<key>/…` is the **client-side** key (`environments/views.py`, `NestedEnvironmentViewSet`).
- The variant key can only be set through `…/features/<id>/mv-options/` (`features/multivariate/serializers.py`).
- The experiment create body, metric enums, results shape and the 5-minute refresh limit (`experimentation/serializers.py`, `models.py`, `views.py`, `constants.py`).

**Not verified (no live account was available while writing the scripts):**
- that Flagsmith Cloud runs the same code as the cloned source today;
- that Experimentation is switched on for your organisation, and that an organisation API key gets environment-admin rights there. The code says admin keys do;
- how a created-but-not-started experiment looks in the dashboard. The wizard normally starts experiments straight away. If it looks odd, just run `--start`.

The one-active-experiment rule is checked **per flag per environment** in the source (`experimentation/views.py`, `ExperimentViewSet.create`). So the A/A experiment does not block Production. Ending the A/A experiment first, as Part B says, is still the tidy order.

---

## SDK facts verified

These were checked by installing the packages and reading their source and type files: `@flagsmith/nodejs` **9.5.0**, which satisfies `^9.1.0`, and `@flagsmith/flagsmith` **12.6.0**, which satisfies `^12.4.0`. Paths are relative to `node_modules/@flagsmith/`.

### Node SDK (`@flagsmith/nodejs`), used by the robot players

| Fact | Evidence |
|---|---|
| Import is a **named** export: `import { Flagsmith } from '@flagsmith/nodejs'` | `nodejs/index.ts` (export list); also checked at runtime |
| `new Flagsmith({ environmentKey, enableEvents: true, eventProcessorConfig?: { maxBuffer, flushInterval, eventsApiUrl } })`. Passing `eventProcessorConfig` without `enableEvents` **throws** | `nodejs/sdk/index.ts:190-203`, `nodejs/sdk/types.ts:129-150` |
| `async getExperimentFlag(featureName: string, identifier: string, traits?)` returns `Promise<Flag \| DefaultFlag>`. It **throws** if `enableEvents` is off | `nodejs/sdk/index.ts:298-305` |
| The return value has `value`, `enabled`, `isDefault`, `variant?: string` (the variant **key**, e.g. `control` or `gentle_ramp`) and `experiment?: { id, name, inExperiment }` | `nodejs/sdk/models.ts:61,116,120` |
| An exposure is recorded **only if** the flag exists, is enabled, `experiment.inExperiment` is true and `variant` is set | `nodejs/sdk/index.ts:309-341` |
| A missing flag returns `{ enabled:false, isDefault:true, value:undefined }` and does not throw | `nodejs/sdk/models.ts:251-260` |
| A network or API failure **throws** ("getIdentityFlags failed and no default flag handler was provided"). Checked at runtime | runtime test |
| `trackEvent(event: string, opts?: { identifier?, value?: string\|number\|boolean\|null, traits?, metadata? }): void`. Synchronous. Throws if events are off or the name starts with `$` | `nodejs/sdk/index.ts:352-376`, `nodejs/sdk/types.ts:11` |
| **A numeric value is supported.** The SDK sends it as text (`String(value)`), and the warehouse uses it for Sum and Mean | `nodejs/sdk/events.ts:312`; docs `create-metrics.md` |
| `async flushEvents()` and `async close(timeoutMs?)`. `close` sends whatever is buffered and then stops | `nodejs/sdk/index.ts:424,519` |
| Defaults: buffer holds **1000** events, with a flush every **10 s**. When the buffer is full and a batch is still in flight, the **oldest event is dropped**. A 401 or 403 makes the processor **silently stop tracking** | `nodejs/sdk/events.ts:16,19,39,100-118` |

### Browser SDK (`@flagsmith/flagsmith`), used by the human-playable game

| Fact | Evidence |
|---|---|
| **Default** export: `import flagsmith from '@flagsmith/flagsmith'` | `flagsmith/index.d.ts:3` |
| `await flagsmith.init({ environmentID, enableEvents: true })` | `flagsmith/types.d.ts:131,152` |
| `identify(userId: string, traits?) => Promise<void>` | `flagsmith/types.d.ts:243` |
| `getExperimentFlag(featureName) => { enabled, value, variant?, experiment? } \| null`. It is **synchronous**. It records an exposure only when the user is identified, the flag is enabled, `experiment.inExperiment` is true, **and the flags came from the server** (not the cache) | `flagsmith/types.d.ts:348`, `flagsmith/src/flagsmith-core.ts:1039-1068` |
| `trackEvent(event, opts?: { identifier?, value?, traits?, metadata? }) => void`. The identifier defaults to the identified user. It does nothing if events are off. A numeric `value` is supported | `flagsmith/types.d.ts:320`, `flagsmith/src/flagsmith-core.ts:981-998` |
| `flushEvents() => Promise<void>`. It never rejects | `flagsmith/types.d.ts:354`, `flagsmith/src/flagsmith-core.ts:1023` |

### How our adapters use them

- `bots/flags.mjs` takes the mode from the flag's **`value`**, which must be one of `normal | gentle_ramp | practice_first`. It keeps `variant`, the key, so the A/A summary can group bots by arm. On any problem it returns `normal`, warns once per kind of problem, and counts the problem in `client.stats.fallbacks`.
- **Loading .env.** `bots/flags.mjs` has a small parser, `loadEnv()`, with no dependency. It reads `.env` from the project root and never overwrites a variable that is already set. That means `node --env-file=.env bots/sim.mjs` (Node 20.6+) also works. You can use either one.
- `web/src/flags.js` goes offline (everyone plays `normal`, `track` does nothing, `isOnline()` returns false) when `VITE_FLAGSMITH_CLIENT_KEY` is empty or Flagsmith cannot be reached.

---

## Order of operations (follow this exactly)

1. **Set up Flagsmith.** Do Part A. Turn on the warehouses first, because they can take hours.
2. **Freeze the plan in git *before* any live run.** Create the repository and push `docs/HYPOTHESIS.md` and the bot model (`bots/brain.js`, `engine/`). The GitHub commit time then proves the hypothesis and the bots were fixed before we saw any results.
   ```bash
   git init
   git add .                  # .env is git-ignored; check with: git status
   git commit -m "Pre-registration: hypothesis and bot model frozen before the live run"
   git branch -M main
   git remote add origin https://github.com/<you>/levelup.git
   git push -u origin main
   ```
   Do not change `docs/HYPOTHESIS.md` or the bot model after this commit. If you must, make a new commit that explains why.
3. **A/A check** in the separate environment (Part B). Save `docs/results/results-aa.json`, then end the A/A experiment.
4. **Real experiment** in Production (Part C). One 4,500-bot live run, once.
5. **Read and save the results** (Part D). Save `docs/results/results-final.json`, take screenshots, then commit and push.
6. **End the experiment and roll out the winner** (Part E).

---

## Part A: One-time setup (about 30 minutes, plus waiting for the warehouse)

### 1. Create the account, project and environments

1. Sign up at <https://app.flagsmith.com> (Flagsmith Cloud).
2. Create an **Organisation**, then a **Project** called `Level Up`.
3. A new project comes with two environments, **Development** and **Production**.
   - **Production** holds the **real experiment**.
   - **Development** holds the **A/A check**. You may rename it to `AA Check` in **Environment Settings › General**.
   - Separate environments keep the two sets of data from ever mixing. Exposures, metrics, warehouses and experiments all belong to one environment.

CLI (v2, verified with `flagsmith --help` on v2.0.0):
```bash
npm install -g @flagsmith/cli     # or: brew install Flagsmith/tap/flagsmith
flagsmith --version               # must be v2.x
flagsmith login                   # opens the browser
flagsmith init                    # pick project "Level Up" and environment Production; writes flagsmith.json (no secrets)
flagsmith environment list        # shows each environment's client-side key
```

### 2. Turn on the warehouse. Do this first, because it can take hours.

The managed **Flagsmith warehouse** comes with Flagsmith Cloud. Set it up in **both** environments.

1. Select the environment (top left), then go to **Environment Settings › Warehouse**.
2. Select **Flagsmith**, click **Enable**, then confirm.
3. Click **Send your first event**. The status moves from *Created* to *Pending Connection* to **Connected**.
   > The docs say the first event "can take up to a few hours" to process. Do this early.
4. Repeat for the other environment.

Check it with the API:
```bash
flagsmith api api/v1/environments/<ENV_KEY>/warehouse-connections/
```
`<ENV_KEY>` is the environment's **client-side key**.

### 3. Put the keys in `.env`

1. Copy `.env.example` to `.env`. `.env` is git-ignored. Never commit it.
2. **Production › Environment Settings › Keys**:
   - Create a **Server-side key** (it starts with `ser.`) and paste it as `FLAGSMITH_SERVER_KEY`.
   - Copy the **Client-side Environment Key** into `VITE_FLAGSMITH_CLIENT_KEY`.
3. **Development (AA Check) › Environment Settings › Keys**: create a server-side key and paste it as `FLAGSMITH_SERVER_KEY_AA`.

CLI:
```bash
flagsmith environment key create Production --name levelup-bots
```
The value is shown **only once**. Paste it straight into `.env`.

### 4. Create the multivariate flag `level1_mode`

Feature flags belong to the whole **project**, so this one flag is shared by both environments.

Dashboard:
1. **Features › Create Feature**.
2. Name: `level1_mode`. **Enabled**: on. **Value**: `normal`. This base value is the **control**.
3. Add two variations, each with weight 0:

   | Value | Key / label |
   |---|---|
   | `gentle_ramp` | `gentle_ramp` |
   | `practice_first` | `practice_first` |

   - **Every variation needs a key.** A variation without a key records **no exposures**.
   - `control` is reserved for the base value, so don't use it as a key.
   - Leave the weights at 0. The experiment sets the split itself.
4. Make sure the flag is **enabled in both environments**.

CLI (verified with `--help`):
```bash
flagsmith feature create level1_mode --value normal --enabled
flagsmith feature variant add level1_mode --value gentle_ramp    --key gentle_ramp    --weight 0
flagsmith feature variant add level1_mode --value practice_first --key practice_first --weight 0
flagsmith feature get level1_mode --json   # note the feature "id" and each variant's "id"
```
`--variants` on `feature create` cannot set keys, so use `variant add` as shown.

Quick test: `node scripts/check-flagsmith.mjs`. It should print `value = "normal"` and "No running experiment on this flag yet".

**About the check script.** By default it is **read-only**: it reads the flag for the test identity `levelup-check` and records nothing, so it is safe to run at any time, even while the real experiment is running. The `--expose` option also records one exposure, which **adds that identity to a running experiment as an extra player**. Only use `--expose` **before** the experiment starts, or against the A/A environment (`--expose --aa`). `--identity NAME` picks another test identity. The default stays fixed on purpose: exposures are counted once per identity, so even repeated `--expose` checks add at most one extra player.

### 5. Create the 4 metrics, once in each environment

Metrics belong to one environment, so create these in **Production** and again in **Development (AA Check)**. Event names are **case-sensitive** and must match `engine/constants.js`.

| Name | Event name | Aggregation | Direction | Role |
|---|---|---|---|---|
| Reached Level 3 | `reached_level_3` | Occurrence | Higher is better | **Goal (primary)** |
| Rage quit | `rage_quit` | Occurrence | Lower is better | Guardrail |
| Bored quit | `bored_quit` | Occurrence | Lower is better | Guardrail |
| Walls passed (best run) | `walls_passed` | Mean | Higher is better | Secondary |

Dashboard: **Metrics › Create Metric**, then fill in Name, "What do you want to measure?" (the aggregation), Direction and Event name.

API (body format from Flagsmith's experimentation docs and the Flagsmith API source, `api/experimentation/models.py`). Run it in each environment:
```bash
for m in "Reached Level 3|reached_level_3|occurrence|up" \
         "Rage quit|rage_quit|occurrence|down" \
         "Bored quit|bored_quit|occurrence|down" \
         "Walls passed|walls_passed|mean|up"; do
  IFS='|' read name ev agg dir <<< "$m"
  echo "{\"name\":\"$name\",\"aggregation\":\"$agg\",\"direction\":\"$dir\",\"definition\":{\"version\":1,\"event\":\"$ev\"}}" \
    | flagsmith api api/v1/environments/<ENV_KEY>/experiment-metrics/ -X POST --input -
done
```
Write down each metric's `id`.

### 6. Can one experiment have a primary metric and guardrails?

Yes, as far as we can tell. The public docs only describe picking a **primary** metric in the wizard, and say that a metric's expected direction "sorts metrics into goals and guardrails" (`statistics.md`). The rest of this section is **per our reading of the Flagsmith API source** (github.com/Flagsmith/flagsmith, folder `api/experimentation/`), not the public docs:

- **Many metrics per experiment.** Per our reading of `api/experimentation/serializers.py`, the API takes a `metrics` list, and each entry has its own `expected_direction`: `increase`, `decrease`, `not_increase` or `not_decrease`. You can also attach more metrics later with `POST .../experiments/<id>/metrics/`. Per our reading of `api/experimentation/services.py` (`_experiment_metric_specs`), results are computed for every attached metric.
- **The primary metric is the first one in the list**, per our reading of `frontend/web/components/experiments/constants.ts` (`getPrimaryMetric`).
- **Goal or guardrail.** The docs say the expected direction "sorts metrics into goals and guardrails" (`statistics.md`). For our guardrails, use **`not_increase`** for `rage_quit` and `bored_quit`.
- **Dashboard limits.** In the source we read, the wizard's Measurement step picks **one** primary metric, and the Analysis section draws only the primary metric. Per our reading of the API source, guardrail and secondary results should still appear in `GET .../experiments/<id>/results/` (one entry per metric). **Check this on your first refresh.** If the guardrails are missing there, fall back to the sim summary. The live Cloud dashboard may show more **(unverified)**.
- **What we do.** Create the experiment through the API with all four metrics, `reached_level_3` first. Read the guardrails from the results JSON if they are there. The sim summary prints the same rates from local data either way.

---

## Part B: The A/A check (Development / AA Check environment)

The A/A check runs the whole pipeline with every arm playing `normal`. If Flagsmith then shows a "winner", or the arm sizes are badly uneven, the pipeline is biased. In that case, stop and fix it before the real run.

**Why a separate environment?** Values lock while an experiment runs, and the docs say "a flag can only be in one active experiment at a time". A separate environment keeps the A/A data completely apart from the real experiment: it has its own exposures, metrics and experiment, with the same variant keys, and nothing leaks into Production. Because of the one-active-experiment rule, **end the A/A experiment before you start the real one**.

**How gameplay stays `normal`.** Flagsmith still assigns real arms (`control`, `gentle_ramp`, `practice_first`) and records real exposures. Our adapter, in `aa` mode, forces gameplay to `normal`. Any difference between arms is then noise or bias, never the game.

1. Make sure the Development environment has its warehouse **Connected** (step 2) and its **4 metrics** (step 5).
2. Create the experiment in Development: **Experiments › Create Experiment**.
   - Name: `Level 1 A/A check`.
   - Flag: `level1_mode`.
   - Rollout **100%**, then **Split evenly**.
   - Primary metric: `Reached Level 3`, direction *Increase*.
   - **Create Experiment.** The experiment starts right away.

   Or use the API, as in step C1, with `<AA_ENV_KEY>` in place of the Production key.
3. Check the connection: `node scripts/check-flagsmith.mjs --aa`. It should print `enrolled = true`. This check is read-only: it records nothing.
4. Run: `npm run sim -- --aa --bots 1500 --seed 1`. With `--aa` the sim uses `FLAGSMITH_SERVER_KEY_AA`, so nothing goes to Production.
5. Wait about 2 minutes, then click **Refresh results** (see Part D).
6. **Pass criteria:**
   - each arm has roughly 1/3 of the exposures;
   - no SRM warning;
   - no variation reaches a 95% chance to win, and the credible intervals cross 0.
7. Save the evidence: take screenshots, then save the JSON:
   ```bash
   mkdir -p docs/results
   flagsmith api api/v1/environments/<AA_ENV_KEY>/experiments/<AA_ID>/results/ > docs/results/results-aa.json
   flagsmith api api/v1/environments/<AA_ENV_KEY>/experiments/<AA_ID>/exposures/ > docs/results/exposures-aa.json
   ```
8. **End experiment** with the choice **Roll out control**. Do this before starting the real experiment.

---

## Part C: The real experiment (Production)

### C1. Create the experiment, with all 4 metrics

Dashboard (attaches the primary metric only):
1. **Production › Experiments › Create Experiment**.
2. **Setup**:
   - Name: `Level 1 difficulty`.
   - Hypothesis (paste v2 H1 from `docs/HYPOTHESIS.md`): *"A 10-second practice zone on the first try (practice_first) will increase the share of new players who reach Level 3 by at least 10% versus normal, without increasing bored quits by more than 2 points (v2 H1, docs/HYPOTHESIS.md)."*
   - Flag: `level1_mode`.
3. **Rollout**: **100%**, then **Split evenly** (≈33/33/33).
4. **Measurement**: primary metric `Reached Level 3`, expected direction **Increase**.
5. **Review & Launch**, then **Create Experiment**. It starts immediately and the flag is now **locked**.
6. Attach the guardrails and the secondary metric through the API:
   ```bash
   E=api/v1/environments/<PROD_ENV_KEY>/experiments/<EXPERIMENT_ID>/metrics/
   echo '{"metric": <RAGE_ID>,  "expected_direction": "not_increase"}' | flagsmith api $E -X POST --input -
   echo '{"metric": <BORED_ID>, "expected_direction": "not_increase"}' | flagsmith api $E -X POST --input -
   echo '{"metric": <WALLS_ID>, "expected_direction": "increase"}'     | flagsmith api $E -X POST --input -
   ```

API only (all metrics in one call; the first metric is the primary). Body format from Flagsmith's experimentation docs and the API source (`api/experimentation/serializers.py`):
```bash
cat > /tmp/exp.json <<'EOF'
{
  "feature": <FLAG_ID>,
  "name": "Level 1 difficulty",
  "hypothesis": "A 10-second practice zone on the first try (practice_first) will increase the share of new players who reach Level 3 by at least 10% versus normal, without increasing bored quits by more than 2 points (v2 H1, docs/HYPOTHESIS.md).",
  "metrics": [
    {"metric": <REACHED_ID>, "expected_direction": "increase"},
    {"metric": <RAGE_ID>,    "expected_direction": "not_increase"},
    {"metric": <BORED_ID>,   "expected_direction": "not_increase"},
    {"metric": <WALLS_ID>,   "expected_direction": "increase"}
  ],
  "experiment_rollout": {
    "enabled": false,
    "rollout_percentage": 100,
    "feature_state_value": {"type": "string", "value": "normal"},
    "multivariate_feature_state_values": [
      {"multivariate_feature_option": <GENTLE_RAMP_VARIANT_ID>,    "percentage_allocation": 33.33},
      {"multivariate_feature_option": <PRACTICE_FIRST_VARIANT_ID>, "percentage_allocation": 33.33}
    ]
  }
}
EOF
flagsmith api api/v1/environments/<PROD_ENV_KEY>/experiments/ -X POST --input /tmp/exp.json        # note "id"
flagsmith api api/v1/environments/<PROD_ENV_KEY>/experiments/<ID>/start/ -X POST                    # locks the flag
flagsmith api api/v1/environments/<PROD_ENV_KEY>/experiments/<ID>/ --jq .status                     # "running"
```
In the API, `"feature_state_value"` is the **control** value. Control gets whatever the variations leave over (33.34%). `"enabled": false` matches the dashboard wizard: nothing is served until `start/` switches the rollout on (`api/experimentation/services.py`, `enable_experiment_rollout`).

### C2. Run the robot players

1. `node scripts/check-flagsmith.mjs` (read-only, no `--expose`). Expect `enrolled = true`.
2. `npm run sim -- --bots 4500 --seed 2026`. That is 1,500 bots per arm. Use a seed never used in a dry run (2026), so the live bots are fresh personalities, as v2 promises.
   - By default the live run gets a **timestamped tag**, so every bot id (`bot-<tag>-<n>`) is new. The sim **refuses to reuse a tag**, so you can't accidentally replay the same identities into the experiment.
   - **Run this exactly once against Production.** Do **not** do a smaller "test" live run (for example 600 bots) against Production, and do not run it a second time for the camera. Every live bot becomes a real participant in the experiment. **For the video, film this one real 4,500-bot run**, or film `npm run sim:dry` (offline) and say on screen that it is the offline version.
3. The sim prints `flags: { exposures, events, fallbacks }`. **`fallbacks` must be 0.** If it isn't, some bots never reached Flagsmith, and the run should not be used.

**Volume, concurrency and limits for about 4,500 bots:**
- **API calls.** Each bot makes **1** identity call (`getExperimentFlag`). That is about 4,500 calls for the real run plus about 1,500 for the A/A run. The docs say SDK requests are **not rate-limited**, but identity calls **count towards the monthly plan limit**. Check your plan on the pricing page; the free-plan figure is not stated in the docs **(unverified)**. Management API calls (CLI/`flagsmith api`) are limited to 500 per minute and are not billable.
- **Concurrency.** The sim runs 20 bots in parallel, which is fine. Going above about 50 gains little and makes failures more likely.
- **Events.** There are about 4,500 exposures plus about 2 to 4 conversions per bot, so roughly 15,000 to 20,000 events. With the SDK defaults (1,000-event buffer, 10-second flush), a fast sim can **drop the oldest events**. The adapter therefore sets `maxBuffer: 5000` and `flushInterval: 2000`, flushes every 500 tracked events, and calls `close(30000)` at the end to send the rest. A batch over 2 MiB is rejected whole. Our batches stay far below that.
- **Timestamps.** Events older than 10 days are rejected, so run the sim on the day you analyse.
- **Waiting.** After the sim exits, wait **about 2 minutes** before the first refresh. Results can be refreshed **once every 5 minutes**. If numbers are missing, wait and refresh again; ingestion can lag a few minutes.

---

## Part D: Read the results

Dashboard: open the experiment and click **Refresh results** (once per 5 minutes). Check the **As of** time, the **Exposures** panel, the scorecards, and the analysis table: Delta, 95% credible interval, and Win probability.

API:
```bash
flagsmith api api/v1/environments/<ENV_KEY>/experiments/<ID>/results/refresh/ -X POST   # 202 = accepted
sleep 60
flagsmith api api/v1/environments/<ENV_KEY>/experiments/<ID>/results/     # all 4 metrics, per variant
flagsmith api api/v1/environments/<ENV_KEY>/experiments/<ID>/exposures/   # exposures per variant
```
Link to the experiment page: `https://app.flagsmith.com/project/<PROJECT_ID>/environment/<ENV_KEY>/experiments/<ID>`

Rules for reading the results:
- An arm with fewer than 50 identities, or fewer than 5 conversions on an occurrence metric, shows **Collecting data**.
- A **95%** chance to beat control shows the "roll out" banner.
- If the credible interval crosses 0, the result is inconclusive.

**SRM note, per our reading of the API source** (`api/experimentation/services.py` `_expected_variant_shares` and `api/experimentation/stats.py` `srm_p_value`), not the public docs. The SRM check compares arm sizes against the environment's default weights. Starting an experiment resets those weights to 0, and the check then skips itself (`srm_p_value` returns `None` when a share is 0). So **a missing SRM warning may just mean the check did not run.** Always look at the per-arm exposure counts yourself. With 4,500 bots, each arm should hold 1,500 ± about 80.

---

## Part E: Roll out the winner (in this exact order)

The flag is **locked while the experiment runs**, so you cannot just edit it.

1. **Record the results first.** Take screenshots of the results page and the exposures panel. Save the JSON in `docs/results/` (committed to git; `runs/` is git-ignored):
   ```bash
   mkdir -p docs/results
   flagsmith api api/v1/environments/<PROD_ENV_KEY>/experiments/<ID>/results/   > docs/results/results-final.json
   flagsmith api api/v1/environments/<PROD_ENV_KEY>/experiments/<ID>/exposures/ > docs/results/exposures-final.json
   git add docs/results && git commit -m "Final experiment results" && git push
   ```
2. **End the experiment.** Click **End Experiment** on the experiment page and choose **Roll out a variant**, then pick the winner (we predict `practice_first`). Choose **Roll out control** if nothing won. Results are frozen as final and the flag is unlocked.

   API (choices verified in `api/experimentation/models.py` `RolloutDecision`):
   ```bash
   echo '{"rollout_decision": "variant", "rollout_variant": <WINNING_VARIANT_ID>}' \
     | flagsmith api api/v1/environments/<PROD_ENV_KEY>/experiments/<ID>/complete/ -X POST --input -
   # or {"rollout_decision": "control"}
   ```
   Ending with "variant" sets that variant's weight to **100%** in Production (`services.py` around line 674), so **everyone now gets the winner.**
3. **Check it:**
   ```bash
   flagsmith eval level1_mode --identity anyone-123 --jq .value
   ```
   Expect the winner's value, e.g. `"practice_first"`. `node scripts/check-flagsmith.mjs` should show the same.
4. **Later cleanup, optional.** Make the winner permanent. You can set the flag's base value to the winning string, or hard-code the mode and delete the flag. Then remove the losing variations. An ended experiment cannot be restarted. A new test needs a new experiment.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| **No exposures** on the Exposures panel | Warehouse not *Connected*; experiment not started; a variation has no **key**; flag disabled in that environment; rollout below 100%; the process exited before events were sent | Check Warehouse status (step 2). Run `node scripts/check-flagsmith.mjs` (read-only) and look for `enrolled = true`. Run `flagsmith feature get level1_mode --json` and check that both variants have keys. Make sure the sim reaches `client.close()`. |
| Check script says "not enrolled" | Experiment not started, or this is the wrong environment's key | Start it (`.../start/`). Check that `FLAGSMITH_SERVER_KEY` belongs to the environment that has the experiment. |
| **Conversions not counted** | Event name does not match the metric exactly (case-sensitive); different identifier from the exposure; event sent before the first exposure | Use the names from `engine/constants.js`. Send events with the same `bot-…` id. Call `getLevelMode` before any `track`. |
| `walls_passed` mean is empty | `value` missing, or the metric is not set to **Mean** | `track(id, 'walls_passed', best)` with a number. Recreate the metric with Mean. |
| **SRM warning** | Arms not split as configured: bots crashed before exposure, retries changed ids, or the rollout was edited mid-run | Don't act on the results. Compare the sim's per-arm counts, fix, and rerun with a new `--tag`, which gives fresh identities. |
| **Results not updating** | Refreshed less than 5 minutes ago; ingestion lag; first warehouse event still processing | Wait, then click **Refresh results** again. Check the **As of** time. A brand-new warehouse can take hours for its first event. |
| `fallbacks > 0` in the sim summary | Bad or missing key, network error, flag missing or disabled | Read the first `[flags] WARNING` line. Run the check script. |
| Events silently stop | A 401 or 403 from the events API (wrong key) makes the SDK stop tracking for the rest of the process | Fix the key, restart. |
| Browser always plays `normal` | `VITE_FLAGSMITH_CLIENT_KEY` is empty in `.env`, or the dev server was started before `.env` was filled in | Check `isOnline()` in the console. Fill in `.env` and restart `npm run dev`. |

### CLI commands status

**Verified** against `flagsmith --help` (v2.0.0, `npm i @flagsmith/cli`): `login`, `init`, `project list`, `environment list`, `environment key create <env> --name`, `feature create --value --enabled`, `feature variant add --value --key --weight`, `feature get`, `evaluate/eval --identity --jq`, `api <path> -X -F --input`.

**Verified against the Flagsmith API source** (`api/experimentation/*`): `experiment-metrics/` POST body; `experiments/` POST body; `experiments/<id>/metrics/`; `start/`, `complete/`, `results/`, `results/refresh/`, `exposures/`.

**Unverified:** exact dashboard labels in the current Cloud UI, and plan request quotas.
