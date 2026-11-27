// One-command Flagsmith setup for Level Up (instead of many dashboard clicks).
//
// Usage:
//   node scripts/setup-flagsmith.mjs                 set up Production (flag, variants, metrics, experiment). Does NOT start it.
//   node scripts/setup-flagsmith.mjs --start         same, then START the experiment (locks the flag, exposures begin)
//   node scripts/setup-flagsmith.mjs --aa            same for the A/A environment (uses FLAGSMITH_ENVIRONMENT_KEY_AA)
//   node scripts/setup-flagsmith.mjs --env-key-var NAME   use the environment key stored in the .env variable NAME
//   node scripts/setup-flagsmith.mjs --dry-print     print every planned request and send NOTHING (no keys needed)
//   node scripts/setup-flagsmith.mjs --humans        a SEPARATE experiment for real human players in the
//                                                    Development environment (key FLAGSMITH_ENVIRONMENT_KEY_AA),
//                                                    created after the A/A experiment has ended
//   node scripts/setup-flagsmith.mjs --name "..."    experiment name (default "Level 1 difficulty", or "Level 1 A/A check" for A/A)
//
// It is IDEMPOTENT: every step first looks for the thing it wants to create. Running it twice
// creates nothing new the second time. It never deletes or edits a metric or an experiment.
//
// What it does, in order:
//   1. Find the environment (and its project) from the environment key.
//   2. Check the warehouse connection (only warns; connect it in the dashboard).
//   3. Flag `level1_mode`: multivariate, base value `normal` (= control), enabled.
//   4. Variants `gentle_ramp` and `practice_first`, each with key = value and weight 0
//      (the experiment sets the real split; creating it resets the defaults to 0 anyway).
//   5. The 4 metrics (event names from engine/constants.js).
//   6. The experiment: hypothesis = v2 H1 from docs/HYPOTHESIS.md, 100% traffic, even 3-way split,
//      all 4 metrics with the primary metric FIRST.
//   7. Only with --start: start it.
//
// Keys are never printed. Any HTTP error stops the script with the status and the API's message.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FLAG, EVENTS } from '../engine/constants.js';
import { api, listAll, loadConfig, describeRequest, parseArgs, fail, redact, ApiError } from './flagsmith-api.mjs';

// ---------------------------------------------------------------------------
// The plan (pure data, no network). Tests check these.
// ---------------------------------------------------------------------------

export const CONTROL_VALUE = 'normal';
export const VARIANT_VALUES = ['gentle_ramp', 'practice_first']; // key = value for each

// The 4 metrics. Enum values are from api/experimentation/models.py:
//   aggregation: MetricAggregation  ("count" | "sum" | "mean" | "occurrence")
//   direction:   MetricDirection    ("up" | "down" | "informational")
//   expected:    ExpectedDirection  ("increase" | "decrease" | "not_increase" | "not_decrease")
// definition must be {"version": 1, "event": "<name>"} (api/experimentation/metric_definitions.py).
// ORDER MATTERS: the first metric attached is the primary metric.
export const METRICS = [
  { name: 'Reached Level 3', event: EVENTS.REACHED_LEVEL_3, aggregation: 'occurrence', direction: 'up', expected: 'increase', role: 'goal (primary)' },
  { name: 'Rage quit', event: EVENTS.RAGE_QUIT, aggregation: 'occurrence', direction: 'down', expected: 'not_increase', role: 'guardrail' },
  { name: 'Bored quit', event: EVENTS.BORED_QUIT, aggregation: 'occurrence', direction: 'down', expected: 'not_increase', role: 'guardrail' },
  { name: 'Walls passed (best run)', event: EVENTS.WALLS_PASSED, aggregation: 'mean', direction: 'up', expected: 'increase', role: 'secondary' },
];

export const HUMAN_HYPOTHESIS = 'Exploratory (real human players, small sample): practice_first will raise the share of players who reach Level 3 versus normal. Expected to be inconclusive at this sample size; the robot run in Production is the primary result (docs/HYPOTHESIS.md, Part 5).';
export const AA_HYPOTHESIS = 'A/A check: every arm plays the normal Level 1, so no arm should beat control and the split should be even. If one does, the pipeline is biased (docs/HYPOTHESIS.md, run plan step 1).';

// Pull the v2 H1 text out of docs/HYPOTHESIS.md, as one plain line (no markdown).
export function extractH1(markdown) {
  const line = markdown.split('\n').find((l) => l.trim().startsWith('> **H1'));
  if (!line) return null;
  return line
    .replace(/^\s*>\s*/, '')             // the "> " quote marker
    .replace(/\*\*H1[^*]*\*\*\s*/, '')   // the bold "**H1 (primary).**" label
    .replace(/`/g, '')                   // backticks around names
    .trim();
}

// Body for POST projects/<id>/features/ (api/features/serializers.py CreateFeatureSerializer).
export function featureBody() {
  return {
    name: FLAG,
    initial_value: CONTROL_VALUE,
    default_enabled: true,
    description: 'Level Up: which Level 1 a player gets. normal = control. Managed by scripts/setup-flagsmith.mjs.',
  };
}

// Body for POST projects/<id>/features/<id>/mv-options/.
// The key can ONLY be set through this endpoint (api/features/multivariate/serializers.py:
// the nested serializer marks `key` read-only). default_percentage_allocation defaults to 100
// in the model, so we must send 0 explicitly.
export function variantBody(featureId, value) {
  return { feature: featureId, type: 'unicode', string_value: value, key: value, default_percentage_allocation: 0 };
}

// Body for POST environments/<key>/experiment-metrics/.
export function metricBody(m) {
  return { name: m.name, description: `${m.role}: event "${m.event}"`, aggregation: m.aggregation, direction: m.direction, definition: { version: 1, event: m.event } };
}

// An even split: n variants plus control. Each variant gets 33.33 with 2 variants;
// control gets what is left (33.34). Rounded to 2 decimals.
export function evenSplit(variantIds) {
  const share = Math.floor((100 / (variantIds.length + 1)) * 100) / 100;
  return variantIds.map((id) => ({ multivariate_feature_option: id, percentage_allocation: share }));
}

// Body for POST environments/<key>/experiments/ (api/experimentation/serializers.py ExperimentSerializer).
//   - experiment_rollout is REQUIRED when creating.
//   - enabled: false, like the dashboard wizard (frontend CreateExperimentWizard.tsx). Starting the
//     experiment switches it on (services.py enable_experiment_rollout), so nothing is served before --start.
//   - feature_state_value is the CONTROL value.
export function experimentBody({ featureId, name, hypothesis, variantIds, metricIds }) {
  return {
    feature: featureId,
    name,
    hypothesis,
    metrics: METRICS.map((m) => ({ metric: metricIds[m.event], expected_direction: m.expected })),
    experiment_rollout: {
      enabled: false,
      rollout_percentage: 100,
      feature_state_value: { type: 'string', value: CONTROL_VALUE },
      multivariate_feature_state_values: evenSplit(variantIds),
    },
  };
}

// Does an existing metric match what we want? Returns a list of differences (empty = OK).
export function metricDifferences(existing, wanted) {
  const diffs = [];
  if (existing.aggregation !== wanted.aggregation) diffs.push(`aggregation is "${existing.aggregation}", want "${wanted.aggregation}"`);
  if (existing.direction !== wanted.direction) diffs.push(`direction is "${existing.direction}", want "${wanted.direction}"`);
  return diffs;
}

// The experiment on our flag that is not finished yet (Flagsmith allows only one per flag
// per environment: views.py ExperimentViewSet.create returns 409 otherwise).
export function findActiveExperiment(experiments, featureId) {
  const onFlag = experiments.filter((e) => (e.feature?.id ?? e.feature) === featureId);
  return {
    active: onFlag.find((e) => e.status !== 'completed') ?? null,
    completed: onFlag.filter((e) => e.status === 'completed'),
  };
}

// ---------------------------------------------------------------------------
// The steps (talk to Flagsmith).
// ---------------------------------------------------------------------------

const say = (msg) => console.log(msg);

function settingsFromArgs(args) {
  const humans = !!args.humans;
  const envKeyVar = typeof args['env-key-var'] === 'string' ? args['env-key-var'] : (args.aa || humans) ? 'FLAGSMITH_ENVIRONMENT_KEY_AA' : 'FLAGSMITH_ENVIRONMENT_KEY';
  const isAA = /_AA$/.test(envKeyVar) && !humans;
  const name = typeof args.name === 'string' ? args.name : humans ? 'Level 1 real players' : isAA ? 'Level 1 A/A check' : 'Level 1 difficulty';
  return { envKeyVar, isAA, name, humans };
}

function readHypothesis(isAA, humans = false) {
  if (humans) return HUMAN_HYPOTHESIS;
  if (isAA) return AA_HYPOTHESIS;
  const md = readFileSync(new URL('../docs/HYPOTHESIS.md', import.meta.url), 'utf8');
  const h1 = extractH1(md);
  if (!h1) throw new Error('Could not find the "> **H1 (primary).**" line in docs/HYPOTHESIS.md.');
  return h1;
}

// --dry-print: show every request we WOULD send, with placeholders for ids we do not know yet.
function printPlan(cfg, { name, isAA, start }) {
  const P = cfg.projectId ?? '<project id>';
  const E = `environments/${cfg.envKey || `<${cfg.envKeyVar}>`}/`;
  const show = (method, path, body) => say(describeRequest(cfg, method, path, body));
  say('DRY PRINT: nothing is sent. Each step below first does a GET to see if the thing already exists.\n');
  show('GET', E);
  show('GET', `${E}warehouse-connections/?exclude_event_stats=true`);
  show('GET', `projects/${P}/features/?search=${FLAG}&environment=<environment id>&page_size=999`);
  show('POST', `projects/${P}/features/`, featureBody());
  show('GET', `projects/${P}/features/<feature id>/mv-options/`);
  for (const v of VARIANT_VALUES) show('POST', `projects/${P}/features/<feature id>/mv-options/`, variantBody('<feature id>', v));
  show('GET', `${E}experiment-metrics/?page_size=999`);
  for (const m of METRICS) show('POST', `${E}experiment-metrics/`, metricBody(m));
  show('GET', `${E}experiments/?page_size=999`);
  const metricIds = Object.fromEntries(METRICS.map((m) => [m.event, `<${m.event} metric id>`]));
  show('POST', `${E}experiments/`, experimentBody({ featureId: '<feature id>', name, hypothesis: readHypothesis(isAA), variantIds: ['<gentle_ramp id>', '<practice_first id>'], metricIds }));
  if (start) show('POST', `${E}experiments/<experiment id>/start/`);
  say(`\nTarget: ${isAA ? 'A/A' : 'Production'} environment from ${cfg.envKeySource}. Start: ${start ? 'yes' : 'no (add --start)'}.`);
  if (cfg.problems.length) say(`\nBefore a real run, fix these in .env:\n  - ${cfg.problems.join('\n  - ')}`);
}

async function stepEnvironment(cfg) {
  const env = await api(cfg, 'GET', `environments/${cfg.envKey}/`);
  if (cfg.projectId && env.project !== cfg.projectId) {
    throw new ApiError(`The environment in ${cfg.envKeySource} belongs to project ${env.project}, but FLAGSMITH_PROJECT_ID is ${cfg.projectId}. Fix one of them.`);
  }
  say(`OK    Environment "${env.name}" (id ${env.id}) in project ${env.project}.`);
  return env;
}

async function stepWarehouse(cfg) {
  try {
    const conns = await api(cfg, 'GET', `environments/${cfg.envKey}/warehouse-connections/?exclude_event_stats=true`);
    const list = Array.isArray(conns) ? conns : conns?.results ?? [];
    if (list.length === 0) say('WARN  No warehouse connection in this environment. Events will not be stored. Connect one: Experiments > Warehouse (FLAGSMITH_SETUP.md, step 2).');
    else say(`${list[0].status === 'connected' ? 'OK  ' : 'WARN'}  Warehouse "${list[0].name}" status: ${list[0].status}${list[0].status === 'connected' ? '' : ' (send one event with: node scripts/check-flagsmith.mjs --send-event)'}.`);
  } catch (err) {
    // Only a check: do not stop the setup for it.
    say(`WARN  Could not read the warehouse status (HTTP ${err.status ?? '?'}). Check it in the dashboard.`);
  }
}

async function stepFeature(cfg, projectId, envId) {
  const features = await listAll(cfg, `projects/${projectId}/features/?search=${FLAG}&environment=${envId}&page_size=999`);
  let feature = features.find((f) => f.name === FLAG);
  if (feature) {
    say(`OK    Flag "${FLAG}" already exists (id ${feature.id}).`);
    if (feature.environment_feature_state && feature.environment_feature_state.enabled === false) {
      say(`WARN  "${FLAG}" is DISABLED in this environment. Turn it on in the dashboard, or no exposures will be recorded.`);
    }
  } else {
    feature = await api(cfg, 'POST', `projects/${projectId}/features/`, featureBody());
    say(`NEW   Created flag "${FLAG}" (id ${feature.id}), base value "${CONTROL_VALUE}", enabled.`);
  }
  return feature;
}

async function stepVariants(cfg, projectId, featureId) {
  const base = `projects/${projectId}/features/${featureId}/mv-options/`;
  const options = await listAll(cfg, base);
  const ids = [];
  for (const value of VARIANT_VALUES) {
    let opt = options.find((o) => o.key === value) ?? options.find((o) => o.string_value === value);
    if (!opt) {
      opt = await api(cfg, 'POST', base, variantBody(featureId, value));
      say(`NEW   Created variant "${value}" (key "${value}", weight 0, id ${opt.id}).`);
    } else if (!opt.key) {
      // A variant without a key records NO exposures, so add the key.
      opt = await api(cfg, 'PUT', `${base}${opt.id}/`, { ...variantBody(featureId, value), default_percentage_allocation: opt.default_percentage_allocation ?? 0 });
      say(`FIX   Variant "${value}" had no key; set key "${value}" (id ${opt.id}).`);
    } else {
      say(`OK    Variant "${value}" exists (key "${opt.key}", id ${opt.id}).`);
      if (opt.string_value !== value) say(`WARN  Variant with key "${opt.key}" has value "${opt.string_value}", expected "${value}". The bots read the VALUE.`);
    }
    ids.push(opt.id);
  }
  return ids;
}

async function stepMetrics(cfg) {
  const path = `environments/${cfg.envKey}/experiment-metrics/`;
  const existing = await listAll(cfg, `${path}?page_size=999`);
  const ids = {};
  for (const m of METRICS) {
    const found = existing.find((e) => e.definition?.event === m.event);
    if (found) {
      const diffs = metricDifferences(found, m);
      if (diffs.length) {
        throw new ApiError(`Metric "${found.name}" (id ${found.id}) for event "${m.event}" already exists but ${diffs.join(' and ')}. Fix or delete it in the dashboard (Metrics), then re-run.`);
      }
      say(`OK    Metric "${found.name}" exists (id ${found.id}, ${m.aggregation}, ${m.direction}).`);
      ids[m.event] = found.id;
    } else {
      const made = await api(cfg, 'POST', path, metricBody(m));
      say(`NEW   Created metric "${m.name}" (id ${made.id}): ${m.aggregation} of "${m.event}", ${m.direction === 'up' ? 'higher' : 'lower'} is better.`);
      ids[m.event] = made.id;
    }
  }
  return ids;
}

async function stepExperiment(cfg, { featureId, variantIds, metricIds, name, hypothesis, humans = false }) {
  const base = `environments/${cfg.envKey}/experiments/`;
  const all = await listAll(cfg, `${base}?page_size=999`);
  const { active, completed } = findActiveExperiment(all, featureId);

  // --humans: real players must never land in the A/A experiment.
  if (humans && active && active.name !== name) {
    throw new ApiError(`Experiment "${active.name}" (id ${active.id}) is still ${active.status} in this environment. End it in the dashboard first (End Experiment -> Roll out control), then run --humans again.`);
  }

  if (active) {
    say(`OK    Experiment "${active.name}" already exists on "${FLAG}" (id ${active.id}, status ${active.status}).`);
    // Attach any of our metrics that are missing (allowed while not completed).
    const detail = await api(cfg, 'GET', `${base}${active.id}/`);
    const attached = new Set((detail.metrics ?? []).map((x) => x.metric));
    for (const m of METRICS) {
      if (attached.has(metricIds[m.event])) continue;
      await api(cfg, 'POST', `${base}${active.id}/metrics/`, { metric: metricIds[m.event], expected_direction: m.expected });
      say(`NEW   Attached metric "${m.name}" (${m.expected}) to the experiment.`);
    }
    if ((detail.metrics ?? [])[0] && detail.metrics[0].metric !== metricIds[EVENTS.REACHED_LEVEL_3]) {
      say('WARN  The first attached metric is not reached_level_3, so the dashboard may treat another metric as primary.');
    }
    if (detail.hypothesis && detail.hypothesis !== hypothesis) say('WARN  The stored hypothesis text differs from docs/HYPOTHESIS.md. (Not changed by this script.)');
    return active;
  }

  if (completed.length && !humans) {
    throw new ApiError(`"${FLAG}" already has a COMPLETED experiment in this environment (id ${completed.map((e) => e.id).join(', ')}). A finished experiment cannot be restarted, and this script will not create a second one by itself. If you really need a new one, create it in the dashboard.`);
  }

  const made = await api(cfg, 'POST', base, experimentBody({ featureId, name, hypothesis, variantIds, metricIds }));
  say(`NEW   Created experiment "${name}" (id ${made.id}, status ${made.status}): 100% of identities, even split, 4 metrics (reached_level_3 first).`);
  return made;
}

async function stepStart(cfg, experiment) {
  if (experiment.status === 'running') return say('OK    Experiment is already running.');
  if (experiment.status !== 'created') {
    return say(`WARN  Experiment status is "${experiment.status}", so it was not started. Resume or check it in the dashboard.`);
  }
  const started = await api(cfg, 'POST', `environments/${cfg.envKey}/experiments/${experiment.id}/start/`);
  say(`START Experiment started (status ${started?.status ?? 'running'}). The flag is now locked; exposures are recorded from now on.`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const { envKeyVar, isAA, name, humans } = settingsFromArgs(args);
  const cfg = loadConfig({ envKeyVar, needAdminKey: !args['dry-print'] });

  if (args['dry-print']) return printPlan(cfg, { name, isAA, start: !!args.start });
  if (cfg.problems.length) fail(`Settings missing or wrong:\n  - ${cfg.problems.join('\n  - ')}`, cfg);

  say(`Setting up Flagsmith for Level Up: ${humans ? 'REAL PLAYERS (Development)' : isAA ? 'A/A check' : 'Production'} environment (key from ${cfg.envKeySource}).\n`);
  try {
    const hypothesis = readHypothesis(isAA, humans);
    const env = await stepEnvironment(cfg);
    await stepWarehouse(cfg);
    const feature = await stepFeature(cfg, env.project, env.id);
    const variantIds = await stepVariants(cfg, env.project, feature.id);
    const metricIds = await stepMetrics(cfg);
    const experiment = await stepExperiment(cfg, { featureId: feature.id, variantIds, metricIds, name, hypothesis, humans });
    if (args.start) await stepStart(cfg, experiment);
    else if (experiment.status === 'created') say('\nNOT STARTED (on purpose). When you are ready to run the bots, re-run with --start.');

    say(`\nDone. Experiment id ${experiment.id}. Dashboard: https://app.flagsmith.com/project/${env.project}/environment/<${cfg.envKeySource}>/experiments/${experiment.id}`);
    say(`Next: node scripts/check-flagsmith.mjs${isAA ? ' --aa' : ''}   (expect enrolled = true once started)`);
  } catch (err) {
    fail(err.message, cfg);
  }
}

// Run main() only when this file is started directly (not when a test imports it).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\nFAIL  ${redact(err.message, {})}`);
    process.exit(1);
  });
}
