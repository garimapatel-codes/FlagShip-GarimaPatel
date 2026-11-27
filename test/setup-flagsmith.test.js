// Tests for the Flagsmith setup and results scripts.
// They test only the "pure" parts (building requests, building the table): no network, no keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRequest, readConfig, redact, parseArgs, describeRequest, api, ApiError } from '../scripts/flagsmith-api.mjs';
import {
  METRICS, extractH1, featureBody, variantBody, metricBody, evenSplit, experimentBody, metricDifferences, findActiveExperiment,
} from '../scripts/setup-flagsmith.mjs';
import { buildResultsMarkdown, chiSquareEven, exposuresPerArm, verdictFor, pickExperiment } from '../scripts/fetch-results.mjs';
import { EVENTS } from '../engine/constants.js';

const FAKE = { FLAGSMITH_ADMIN_API_KEY: 'admin-secret-123', FLAGSMITH_ENVIRONMENT_KEY: 'envKeyABC' };
const fixture = JSON.parse(readFileSync(new URL('./fixtures/flagsmith-results.json', import.meta.url), 'utf8'));

test('config: reads keys, adds the default API URL, and catches a "ser." key in the wrong place', () => {
  const cfg = readConfig({ env: FAKE });
  assert.equal(cfg.apiUrl, 'https://api.flagsmith.com/api/v1/');
  assert.deepEqual(cfg.problems, []);

  const wrong = readConfig({ env: { FLAGSMITH_ADMIN_API_KEY: 'x', FLAGSMITH_ENVIRONMENT_KEY: 'ser.abc' } });
  assert.match(wrong.problems.join(' '), /CLIENT-SIDE/);

  const missing = readConfig({ env: {} });
  assert.equal(missing.problems.length, 2);

  // Production can fall back to the browser's client key (same value).
  const viaVite = readConfig({ env: { FLAGSMITH_ADMIN_API_KEY: 'x', VITE_FLAGSMITH_CLIENT_KEY: 'clientKey' } });
  assert.equal(viaVite.envKey, 'clientKey');
  // ...but the A/A environment never does.
  const aa = readConfig({ envKeyVar: 'FLAGSMITH_ENVIRONMENT_KEY_AA', env: { FLAGSMITH_ADMIN_API_KEY: 'x', VITE_FLAGSMITH_CLIENT_KEY: 'clientKey' } });
  assert.equal(aa.envKey, '');
});

test('request: Api-Key header, JSON body, URL joined to the API root', () => {
  const cfg = readConfig({ env: { ...FAKE, FLAGSMITH_API_URL: 'https://flags.example.com/api/v1' } });
  const { url, init } = buildRequest(cfg, 'POST', 'environments/envKeyABC/experiment-metrics/', { a: 1 });
  assert.equal(url, 'https://flags.example.com/api/v1/environments/envKeyABC/experiment-metrics/');
  assert.equal(init.headers.Authorization, 'Api-Key admin-secret-123');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.body, '{"a":1}');
  assert.equal(buildRequest(cfg, 'GET', 'x/').init.body, undefined);
});

test('secrets never appear in printed text', () => {
  const cfg = readConfig({ env: FAKE });
  assert.equal(redact('key admin-secret-123 and envKeyABC', cfg), 'key *** and ***');
  const line = describeRequest(cfg, 'GET', 'environments/envKeyABC/experiments/');
  assert.ok(!line.includes('envKeyABC'));
  assert.ok(line.includes('<FLAGSMITH_ENVIRONMENT_KEY>'));
});

test('an HTTP error becomes a clear ApiError with status and the API message, without secrets', async () => {
  const cfg = readConfig({ env: FAKE });
  const fakeFetch = async () => new Response('{"detail":"bad key admin-secret-123"}', { status: 401 });
  await assert.rejects(() => api(cfg, 'GET', 'environments/envKeyABC/', undefined, { fetchImpl: fakeFetch }), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 401);
    assert.match(err.message, /HTTP 401/);
    assert.ok(!err.message.includes('admin-secret-123'));
    assert.ok(!err.message.includes('envKeyABC'));
    return true;
  });
  const offline = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  await assert.rejects(() => api(cfg, 'GET', 'x/', undefined, { fetchImpl: offline }), /Could not reach Flagsmith/);
});

test('parseArgs understands flags with and without values', () => {
  assert.deepEqual(parseArgs(['--label', 'aa', '--refresh', '--env-key-var', 'X']), { label: 'aa', refresh: true, 'env-key-var': 'X' });
});

test('H1 is read from docs/HYPOTHESIS.md as one plain line', () => {
  const h1 = extractH1(readFileSync(new URL('../docs/HYPOTHESIS.md', import.meta.url), 'utf8'));
  assert.ok(h1.startsWith('A 10-second practice zone on the first try (practice_first)'), h1);
  assert.ok(!h1.includes('`') && !h1.includes('**'));
  assert.equal(extractH1('no hypothesis here'), null);
});

test('flag and variant bodies: base value normal, keys = values, weight 0', () => {
  assert.deepEqual(featureBody().initial_value, 'normal');
  assert.equal(featureBody().default_enabled, true);
  assert.deepEqual(variantBody(42, 'gentle_ramp'), { feature: 42, type: 'unicode', string_value: 'gentle_ramp', key: 'gentle_ramp', default_percentage_allocation: 0 });
});

test('metric bodies use the exact event names and Flagsmith enum values', () => {
  const bodies = METRICS.map(metricBody);
  assert.deepEqual(bodies.map((b) => b.definition), Object.values(EVENTS).map((event) => ({ version: 1, event })));
  assert.deepEqual(bodies.map((b) => [b.aggregation, b.direction]), [['occurrence', 'up'], ['occurrence', 'down'], ['occurrence', 'down'], ['mean', 'up']]);
  assert.deepEqual(metricDifferences({ aggregation: 'count', direction: 'up' }, METRICS[0]), ['aggregation is "count", want "occurrence"']);
});

test('experiment body: 100% traffic, even split, primary metric first, guardrails not_increase, not served before start', () => {
  const metricIds = { reached_level_3: 11, rage_quit: 12, bored_quit: 13, walls_passed: 14 };
  const body = experimentBody({ featureId: 42, name: 'Level 1 difficulty', hypothesis: 'H1', variantIds: [5, 6], metricIds });
  assert.equal(body.feature, 42);
  assert.deepEqual(body.metrics, [
    { metric: 11, expected_direction: 'increase' },
    { metric: 12, expected_direction: 'not_increase' },
    { metric: 13, expected_direction: 'not_increase' },
    { metric: 14, expected_direction: 'increase' },
  ]);
  assert.equal(body.experiment_rollout.rollout_percentage, 100);
  assert.equal(body.experiment_rollout.enabled, false);
  assert.deepEqual(body.experiment_rollout.feature_state_value, { type: 'string', value: 'normal' });
  assert.deepEqual(evenSplit([5, 6]), [{ multivariate_feature_option: 5, percentage_allocation: 33.33 }, { multivariate_feature_option: 6, percentage_allocation: 33.33 }]);
});

test('finding an existing experiment on the flag (idempotency)', () => {
  const list = [
    { id: 3, feature: { id: 42 }, status: 'completed' },
    { id: 4, feature: { id: 42 }, status: 'created' },
    { id: 5, feature: { id: 99 }, status: 'running' },
  ];
  assert.equal(findActiveExperiment(list, 42).active.id, 4);
  assert.equal(findActiveExperiment(list, 42).completed.length, 1);
  assert.equal(findActiveExperiment([], 42).active, null);
  assert.equal(pickExperiment([{ id: 1, feature: { name: 'level1_mode' }, status: 'completed' }, { id: 2, feature: { name: 'level1_mode' }, status: 'running' }]).id, 2);
});

test('split check: even arms pass, a lopsided split fails', () => {
  assert.deepEqual(exposuresPerArm(fixture.exposures), { control: 1500, gentle_ramp: 1503, practice_first: 1497 });
  assert.ok(chiSquareEven({ a: 1500, b: 1503, c: 1497 }).p > 0.9);
  assert.ok(chiSquareEven({ a: 1700, b: 1400, c: 1400 }).p < 0.001);
});

test('verdict hints follow the v2 decision rule', () => {
  assert.equal(verdictFor({ event: 'reached_level_3', expected: 'increase', inference: null }), 'collecting data');
  assert.equal(verdictFor({ event: 'reached_level_3', expected: 'increase', inference: { lift: 0.2, ci_low: 0.1, ci_high: 0.3, chance_to_win: 0.99 } }), 'beats control (> 95%)');
  assert.equal(verdictFor({ event: 'reached_level_3', expected: 'increase', inference: { lift: 0.01, ci_low: -0.05, ci_high: 0.07, chance_to_win: 0.6 } }), 'inconclusive');
  assert.match(verdictFor({ event: 'bored_quit', expected: 'not_increase', pointsDiff: 0.068, inference: { lift: 4, ci_low: 2, ci_high: 6, chance_to_win: 0 } }), /FAILS guardrail \(\+6\.8 pts > 2\)/);
  assert.equal(verdictFor({ event: 'rage_quit', expected: 'not_increase', pointsDiff: 0.03, inference: { lift: 0.1, ci_low: 0.02, ci_high: 0.2, chance_to_win: 0.01 } }), 'FAILS guardrail (CI fully on the bad side)');
});

test('results table from a fixture shaped like the real serializer output', () => {
  const { markdown, rows } = buildResultsMarkdown(fixture);
  // 4 metrics x 3 arms
  assert.equal(rows.length, 12);
  // control first, then the primary comparison (practice_first), then gentle_ramp
  assert.deepEqual(rows.slice(0, 3).map((r) => r.variant), ['`normal` (control)', '`practice_first`', '`gentle_ramp`']);
  const pf = rows[1];
  assert.equal(pf.metric, '`reached_level_3`');
  assert.equal(pf.identities, 1497);
  assert.equal(pf.value, '53.1%');
  assert.equal(pf.lift, '+23.5%');
  assert.equal(pf.ci, '[+15.0%, +32.0%]');
  assert.equal(pf.verdict, 'beats control (> 95%)');
  const boredGentle = rows.find((r) => r.metric === '`bored_quit`' && r.variant === '`gentle_ramp`');
  assert.equal(boredGentle.value, '8.3% (+6.8 pts)');
  assert.match(boredGentle.verdict, /^FAILS guardrail/);
  const walls = rows.find((r) => r.metric === '`walls_passed`' && r.variant === '`practice_first`');
  assert.equal(walls.value, '19.31');
  // health line
  assert.match(markdown, /Exposures per arm normal 1500 \/ practice_first 1497 \/ gentle_ramp 1503/);
  assert.match(markdown, /Flagsmith SRM `not computed`/);
  assert.match(markdown, /\| Metric \| Variant \| Identities \|/);
  // no results yet
  assert.match(buildResultsMarkdown({ results: { results: null } }).markdown, /No results computed yet/);
});
