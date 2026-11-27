// Connectivity check: "Can this computer talk to our Flagsmith environment?"
//
// Usage:
//   node scripts/check-flagsmith.mjs                    read-only check (records NOTHING in the experiment)
//   node scripts/check-flagsmith.mjs --aa               same, using the A/A environment's key
//   node scripts/check-flagsmith.mjs --expose           also record ONE exposure (enrols the test identity)
//   node scripts/check-flagsmith.mjs --identity NAME    test identity to use (default "levelup-check")
//   node scripts/check-flagsmith.mjs --send-event       also send one harmless "levelup_check" event
//
// IMPORTANT: --expose adds the test identity to a running experiment as one extra player.
// Only use --expose before the experiment starts, or against the A/A environment (--aa).
// The default check is read-only, so it is safe to run against Production at any time.
// The key is never printed.

import { Flagsmith } from '@flagsmith/nodejs';
import { loadEnv } from '../bots/flags.mjs';
import { FLAG, MODES } from '../engine/constants.js';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

loadEnv();
const keyName = args.includes('--aa') ? 'FLAGSMITH_SERVER_KEY_AA' : 'FLAGSMITH_SERVER_KEY';
const key = process.env[keyName];
const flagName = process.env.FLAGSMITH_FLAG || FLAG;
const expose = args.includes('--expose');
// A fixed default id means that even with --expose, many checks add at most ONE identity
// (exposures are de-duplicated per identity).
const testId = argValue('identity', 'levelup-check');

if (!key) {
  console.log(`FAIL  ${keyName} is not set. Copy .env.example to .env and paste your server-side key.`);
  process.exit(1);
}
// Show only what KIND of key it is, never the key itself.
console.log(`Key   ${keyName}: ${key.startsWith('ser.') ? 'server-side key (ser.…) found' : 'found, but it does not start with "ser." – is it the client-side key?'}`);
console.log(`Mode  ${expose ? 'WILL record one exposure for the test identity' : 'read-only (no exposure recorded)'}`);

const flagsmith = new Flagsmith({ environmentKey: key, enableEvents: true });
let ok = true;
try {
  // getExperimentFlag = read the flag AND record an exposure.
  // getIdentityFlags  = read the flag only (nothing recorded).
  const flag = expose
    ? await flagsmith.getExperimentFlag(flagName, testId)
    : (await flagsmith.getIdentityFlags(testId)).getFlag(flagName);

  console.log(`Flag  "${flagName}" for identity "${testId}":`);
  console.log(`      value   = ${JSON.stringify(flag.value)} ${MODES.includes(flag.value) ? '(valid mode)' : '(NOT a valid mode – check the flag values)'}`);
  console.log(`      enabled = ${flag.enabled}`);
  console.log(`      variant = ${flag.variant ?? '(none)'}`);
  if (flag.isDefault) {
    ok = false;
    console.log(`FAIL  Flag "${flagName}" was not found in this environment.`);
  } else if (flag.experiment) {
    console.log(`      experiment = "${flag.experiment.name}" (id ${flag.experiment.id}), enrolled = ${flag.experiment.inExperiment}`);
    if (!flag.experiment.inExperiment) {
      console.log('WARN  Experiment exists but this identity is not enrolled (rollout below 100%, or not started).');
    } else {
      console.log(expose
        ? 'OK    Experiment running; one exposure recorded for the test identity.'
        : 'OK    Experiment running and this identity would be enrolled (nothing recorded).');
    }
  } else {
    console.log('WARN  No running experiment on this flag yet. Flags work; exposures start once the experiment is started.');
  }

  if (args.includes('--send-event')) {
    // An event name that no metric uses, so it cannot change any result.
    flagsmith.trackEvent('levelup_check', { identifier: testId, value: 1 });
    console.log('Event sent "levelup_check" (helps a new warehouse switch from "Pending Connection" to "Connected").');
  }
} catch (err) {
  ok = false;
  console.log(`FAIL  Could not reach Flagsmith: ${err.message}`);
  console.log('      Check the key (Environment Settings > Keys) and your internet connection.');
}

// Events are buffered; close() sends them before we exit.
await flagsmith.close(15000);
process.exit(ok ? 0 : 1);
