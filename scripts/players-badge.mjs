// Counts the real human players and writes a tiny JSON file that a README badge can show.
//
// Usage:  node scripts/players-badge.mjs [--experiment-id 1465]
// Needs (from .env locally, or GitHub Actions secrets):
//   FLAGSMITH_ADMIN_API_KEY        organisation API key (secret)
//   FLAGSMITH_ENVIRONMENT_KEY_AA   client-side key of the Development environment
//
// "Players" = unique identities Flagsmith enrolled in the experiment, i.e. phones/browsers,
// not rounds played. One person on one phone counts once, however many times they play.
//
// Output: badges/players.json in the shields.io "endpoint" format:
//   { "schemaVersion": 1, "label": "real players", "message": "9", "color": "ff4fa3" }

import { mkdirSync, writeFileSync } from 'node:fs';
import { api, loadConfig, parseArgs } from './flagsmith-api.mjs';
import { exposuresPerArm } from './fetch-results.mjs';

const args = parseArgs(process.argv.slice(2));
const experimentId = args['experiment-id'] ?? 1465; // "Level 1 real players"
const cfg = loadConfig({ envKeyVar: 'FLAGSMITH_ENVIRONMENT_KEY_AA' });
if (cfg.problems.length) {
  console.error('Settings missing: ' + cfg.problems.join('; '));
  process.exit(1);
}
const base = `environments/${cfg.envKey}/experiments/${experimentId}/`;

// 1. Ask Flagsmith to recount (it allows one refresh per 5 minutes; a refusal is fine).
try {
  await api(cfg, 'POST', `${base}exposures/refresh/`);
  await new Promise((done) => setTimeout(done, 60_000)); // give it a minute to recount
} catch {
  console.log('Refresh not accepted right now; using the latest stored count.');
}

// 2. Read the count and add up the three versions.
const perArm = exposuresPerArm(await api(cfg, 'GET', `${base}exposures/`));
const players = Object.values(perArm).reduce((sum, n) => sum + n, 0);
console.log(`Real players so far: ${players}`, perArm);

// 3. Write the badge file.
mkdirSync(new URL('../badges/', import.meta.url), { recursive: true });
const badge = { schemaVersion: 1, label: 'real players', message: String(players), color: 'ff4fa3' };
writeFileSync(new URL('../badges/players.json', import.meta.url), JSON.stringify(badge) + '\n');
