// Fetch the experiment's results from Flagsmith, save them as evidence, and print a
// Markdown table ready to paste into README's "Live Flagsmith results".
//
// Usage:
//   node scripts/fetch-results.mjs --label final            Production experiment -> docs/results/*-final.json
//   node scripts/fetch-results.mjs --label aa               A/A experiment (uses FLAGSMITH_ENVIRONMENT_KEY_AA)
//   node scripts/fetch-results.mjs --label final --refresh  ask Flagsmith to recompute first, then wait for it
//   node scripts/fetch-results.mjs --label final --from-saved   only re-print the table from the saved files (no network)
//   --env-key-var NAME     read the environment key from another .env variable
//   --experiment-id N      use this experiment instead of finding it by the flag name
//
// Files written (names match README and FLAGSMITH_SETUP.md):
//   docs/results/results-<label>.json      GET .../experiments/<id>/results/
//   docs/results/exposures-<label>.json    GET .../experiments/<id>/exposures/
//   docs/results/experiment-<label>.json   GET .../experiments/<id>/ plus metric event names (needed to re-print the table)
//
// Shape of the results (api/experimentation/serializers.py ExperimentResultsSerializer and
// api/experimentation/dataclasses.py ResultsSummary / MetricResult, stats.py VariantStats / Inference):
//   { results: { as_of, last_error_at, refresh_requested_at, is_final,
//                payload: { srm_p_value, exposures_timeseries,
//                           metrics: [ { metric_id,
//                                        variants:  { control: { n, sum, sum_squares }, practice_first: {...}, ... },
//                                        inference: { practice_first: { lift, ci_low, ci_high, chance_to_win } | null, ... },
//                                        conversions_timeseries } ] } } }
//   n = identities in the arm, sum = conversions (occurrence) or total value (mean).
//   chance_to_win is already flipped for "lower is better" metrics (services.py _infer_treatment),
//   so for rage_quit / bored_quit it is the chance the variant is LOWER (better) than control.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FLAG, EVENTS } from '../engine/constants.js';
import { api, listAll, loadConfig, parseArgs, fail, ApiError } from './flagsmith-api.mjs';

const RESULTS_DIR = new URL('../docs/results/', import.meta.url);
const say = (msg) => console.log(msg);

// Show the primary comparison first, as in docs/HYPOTHESIS.md v2.
const VARIANT_ORDER = ['control', 'practice_first', 'gentle_ramp'];
const BORED_LIMIT_POINTS = 2; // v2 decision rule: bored quits may rise by at most 2 percentage points

// ---------------------------------------------------------------------------
// Pure helpers (no network). Tests check these.
// ---------------------------------------------------------------------------

const pct = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const signedPct = (x, digits = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(digits)}%`;
// Very sure numbers are shown as "> 99.9%" rather than a misleading "100.0%".
const chanceText = (x) => (x > 0.999 ? '> 99.9%' : x < 0.001 ? '< 0.1%' : pct(x));
const signedPts = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} pts`;

// Accept either the API response ({ results: {...} }) or the inner object.
export const unwrap = (obj, key) => (obj && key in obj ? obj[key] : obj);

// Sort variant keys: control, practice_first, gentle_ramp, then anything else.
export function orderVariants(keys) {
  return [...keys].sort((a, b) => {
    const ia = VARIANT_ORDER.indexOf(a), ib = VARIANT_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
}

// Total identities per arm from the exposures endpoint (sum of the timeseries buckets).
export function exposuresPerArm(exposuresResponse) {
  const exp = unwrap(exposuresResponse, 'exposures');
  const totals = {};
  for (const point of exp?.payload?.timeseries?.points ?? []) {
    for (const [variant, n] of Object.entries(point.new_identities ?? {})) totals[variant] = (totals[variant] ?? 0) + n;
  }
  return totals;
}

// Our own split check: chi-square against an EVEN split.
// With 3 arms there are 2 degrees of freedom, and then the p-value is simply exp(-chi2 / 2).
export function chiSquareEven(counts) {
  const values = Object.values(counts);
  const total = values.reduce((a, b) => a + b, 0);
  if (values.length < 2 || total === 0) return null;
  const expected = total / values.length;
  const chi2 = values.reduce((acc, o) => acc + (o - expected) ** 2 / expected, 0);
  const df = values.length - 1;
  return { chi2, df, p: df === 2 ? Math.exp(-chi2 / 2) : null };
}

// A plain-English verdict for one variant row, following the v2 decision rule.
// It is a hint for the humans, not the decision itself.
export function verdictFor({ event, expected, inference, pointsDiff }) {
  if (!inference) return 'collecting data';
  const guardrail = expected === 'not_increase' || expected === 'not_decrease';
  if (guardrail) {
    // For a lower-is-better guardrail, "bad side" means the lift is above 0.
    const worse = expected === 'not_increase' ? inference.ci_low > 0 : inference.ci_high < 0;
    if (event === EVENTS.BORED_QUIT && pointsDiff !== null && pointsDiff * 100 > BORED_LIMIT_POINTS) {
      return `FAILS guardrail (${signedPts(pointsDiff)} > ${BORED_LIMIT_POINTS})`;
    }
    if (worse) return 'FAILS guardrail (CI fully on the bad side)';
    return event === EVENTS.BORED_QUIT ? `passes (≤ ${BORED_LIMIT_POINTS} pts)` : 'passes (not worse)';
  }
  if (inference.chance_to_win > 0.95) return 'beats control (> 95%)';
  if (inference.ci_high < 0) return 'worse than control';
  return 'inconclusive';
}

// Build the Markdown table.
//   results     the /results/ response
//   experiment  the /experiments/<id>/ response (gives metric names and expected directions)
//   eventById   { metricId: eventName } from the metrics list (optional, nicer names)
//   exposures   the /exposures/ response (optional, for the health line)
export function buildResultsMarkdown({ results, experiment, eventById = {}, exposures = null }) {
  const res = unwrap(results, 'results');
  const payload = res?.payload;
  if (!payload) return { markdown: '_No results computed yet. Run with `--refresh`, wait a minute, then run again._', rows: [] };

  const metaById = Object.fromEntries((experiment?.metrics ?? []).map((m) => [m.metric, m]));
  const controlValue = experiment?.experiment_rollout?.feature_state_value?.value || 'normal';
  const label = (v) => (v === 'control' ? `\`${controlValue}\` (control)` : `\`${v}\``);

  const rows = [];
  for (const metric of payload.metrics ?? []) {
    const meta = metaById[metric.metric_id] ?? {};
    const event = eventById[metric.metric_id] ?? meta.metric_name ?? `metric ${metric.metric_id}`;
    const isRate = (meta.aggregation ?? 'occurrence') === 'occurrence';
    const control = metric.variants?.control;
    const controlMean = control && control.n ? control.sum / control.n : null;

    for (const v of orderVariants(Object.keys(metric.variants ?? {}))) {
      const stats = metric.variants[v];
      const mean = stats.n ? stats.sum / stats.n : null;
      const inference = v === 'control' ? undefined : metric.inference?.[v] ?? null;
      const pointsDiff = isRate && mean !== null && controlMean !== null && v !== 'control' ? mean - controlMean : null;
      let value = mean === null ? '–' : isRate ? pct(mean) : mean.toFixed(2);
      if (pointsDiff !== null && meta.expected_direction?.startsWith('not_')) value += ` (${signedPts(pointsDiff)})`;
      rows.push({
        metric: `\`${event}\``,
        variant: label(v),
        identities: stats.n,
        value,
        lift: inference ? signedPct(inference.lift) : '',
        ci: inference ? `[${signedPct(inference.ci_low)}, ${signedPct(inference.ci_high)}]` : '',
        chance: inference ? chanceText(inference.chance_to_win) : '',
        verdict: v === 'control' ? 'control' : verdictFor({ event, expected: meta.expected_direction, inference, pointsDiff }),
      });
    }
  }

  const header = '| Metric | Variant | Identities | Rate / mean | Lift vs control | 95% credible interval | Chance to beat control | Verdict (hint) |\n| --- | --- | --- | --- | --- | --- | --- | --- |';
  const body = rows.map((r) => `| ${r.metric} | ${r.variant} | ${r.identities} | ${r.value} | ${r.lift} | ${r.ci} | ${r.chance} | ${r.verdict} |`).join('\n');

  // Health line: exposures per arm, our split check, Flagsmith's SRM p-value.
  let arms = exposures ? exposuresPerArm(exposures) : {};
  if (Object.keys(arms).length === 0 && payload.metrics?.[0]) {
    arms = Object.fromEntries(Object.entries(payload.metrics[0].variants).map(([k, s]) => [k, s.n]));
  }
  const ordered = orderVariants(Object.keys(arms));
  const split = chiSquareEven(arms);
  const splitText = split ? `${split.p === null || split.p >= 0.001 ? 'PASS' : 'FAIL'}, chi² = ${split.chi2.toFixed(2)}${split.p === null ? '' : `, p = ${split.p.toFixed(3)}`}` : 'n/a';
  const srm = payload.srm_p_value === null || payload.srm_p_value === undefined ? 'not computed' : `p = ${payload.srm_p_value.toFixed(3)}${payload.srm_p_value < 0.001 ? ' (WARNING)' : ''}`;
  const health = `**Health:** Exposures per arm ${ordered.map((k) => `${k === 'control' ? controlValue : k} ${arms[k]}`).join(' / ')} · Split check \`${splitText}\` · Flagsmith SRM \`${srm}\` · As of ${res.as_of ?? '?'}${res.is_final ? ' (final)' : ''}`;

  return { markdown: `${health}\n\n${header}\n${body}\n\n_Chance to beat control for rage_quit / bored_quit is the chance the variant is LOWER (better). Collecting data = fewer than 50 identities or 5 conversions in an arm._`, rows };
}

// Pick the experiment on our flag: running > paused > completed (newest) > created.
export function pickExperiment(experiments, flagName = FLAG) {
  const onFlag = experiments.filter((e) => (e.feature?.name ?? '') === flagName);
  for (const status of ['running', 'paused', 'completed', 'created']) {
    const found = onFlag.find((e) => e.status === status); // the list is newest first
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Network part.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ask Flagsmith to recompute results and exposures. Returns true if accepted.
// Flagsmith refuses a second refresh within 5 minutes (HTTP 429, views.py _validate_refresh_request,
// RESULTS_REFRESH_MIN_INTERVAL in constants.py), and refuses before start or after final results (HTTP 400).
async function requestRefresh(cfg, base) {
  let accepted = false;
  for (const what of ['results', 'exposures']) {
    try {
      await api(cfg, 'POST', `${base}${what}/refresh/`);
      say(`OK    Asked Flagsmith to recompute ${what}.`);
      accepted = true;
    } catch (err) {
      if (err.status === 429) {
        const wait = err.retryAfter ? ` Try again in about ${Math.ceil(Number(err.retryAfter) / 60)} min.` : '';
        say(`WAIT  ${what} refresh refused: one was requested less than 5 minutes ago.${wait} Using the latest stored ${what}.`);
      } else if (err.status === 400) {
        say(`INFO  ${what} refresh refused by Flagsmith: ${err.body}. (Before the experiment starts, or results are already final.)`);
      } else {
        throw err;
      }
    }
  }
  return accepted;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const label = typeof args.label === 'string' ? args.label : args.aa ? 'aa' : null;
  if (!label || !/^[a-z0-9_-]+$/i.test(label)) fail('Please give --label final (Production) or --label aa (A/A check).');
  const envKeyVar = typeof args['env-key-var'] === 'string' ? args['env-key-var'] : label === 'aa' || args.aa ? 'FLAGSMITH_ENVIRONMENT_KEY_AA' : 'FLAGSMITH_ENVIRONMENT_KEY';
  const file = (kind) => new URL(`${kind}-${label}.json`, RESULTS_DIR);

  // Offline: just re-print the table from the saved files.
  if (args['from-saved']) {
    for (const kind of ['results', 'experiment']) if (!existsSync(file(kind))) fail(`docs/results/${kind}-${label}.json not found. Run without --from-saved first.`);
    const read = (kind) => (existsSync(file(kind)) ? JSON.parse(readFileSync(file(kind), 'utf8')) : null);
    const saved = read('experiment');
    say(buildResultsMarkdown({ results: read('results'), exposures: read('exposures'), experiment: saved.experiment, eventById: saved.eventById }).markdown);
    return;
  }

  const cfg = loadConfig({ envKeyVar });
  if (cfg.problems.length) fail(`Settings missing or wrong:\n  - ${cfg.problems.join('\n  - ')}`, cfg);
  const envBase = `environments/${cfg.envKey}/`;

  try {
    // 1. Which experiment?
    let experimentId = args['experiment-id'] ? Number(args['experiment-id']) : null;
    if (!experimentId) {
      const list = await listAll(cfg, `${envBase}experiments/?page_size=999`);
      const picked = pickExperiment(list);
      if (!picked) throw new ApiError(`No experiment on "${FLAG}" in this environment (${cfg.envKeySource}). Run scripts/setup-flagsmith.mjs first.`);
      experimentId = picked.id;
      say(`OK    Experiment "${picked.name}" (id ${picked.id}, status ${picked.status}).`);
    }
    const base = `${envBase}experiments/${experimentId}/`;

    // 2. Optional refresh, then wait (up to ~2 minutes) for the new numbers.
    if (args.refresh) {
      const before = unwrap(await api(cfg, 'GET', `${base}results/`), 'results')?.as_of ?? null;
      if (await requestRefresh(cfg, base)) {
        say('      Waiting for Flagsmith to finish computing (checks every 15 s, up to 2 min)...');
        for (let i = 0; i < 8; i++) {
          await sleep(15000);
          const now = unwrap(await api(cfg, 'GET', `${base}results/`), 'results');
          if (now?.as_of && now.as_of !== before) { say(`OK    New results, as of ${now.as_of}.`); break; }
          if (i === 7) say('WAIT  Still computing. The files below hold the previous numbers; run again (without --refresh) in a minute.');
        }
      }
    }

    // 3. Fetch everything.
    const experiment = await api(cfg, 'GET', base);
    const results = await api(cfg, 'GET', `${base}results/`);
    const exposures = await api(cfg, 'GET', `${base}exposures/`);
    const metrics = await listAll(cfg, `${envBase}experiment-metrics/?page_size=999`);
    const eventById = Object.fromEntries(metrics.map((m) => [m.id, m.definition?.event ?? m.name]));

    // 4. Save the evidence.
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(file('results'), JSON.stringify(results, null, 2) + '\n');
    writeFileSync(file('exposures'), JSON.stringify(exposures, null, 2) + '\n');
    writeFileSync(file('experiment'), JSON.stringify({ experiment, eventById }, null, 2) + '\n');
    say(`SAVED docs/results/results-${label}.json, exposures-${label}.json, experiment-${label}.json\n`);

    // 5. The table.
    const r = unwrap(results, 'results');
    if (r?.last_error_at) say(`WARN  Flagsmith's last refresh FAILED at ${r.last_error_at}; the numbers below are older.\n`);
    say(buildResultsMarkdown({ results, experiment, eventById, exposures }).markdown);
  } catch (err) {
    fail(err.message, cfg);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\nFAIL  ${err.message}`);
    process.exit(1);
  });
}
