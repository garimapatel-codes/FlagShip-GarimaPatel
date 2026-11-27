// Tests for the DRY-RUN Flagsmith adapter (no network, no keys needed).
// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlagClient, stableHash } from '../bots/flags.mjs';
import { MODES } from '../engine/constants.js';

test('the same bot always gets the same mode', async () => {
  const a = await createFlagClient({ dryRun: true, runTag: 't1' });
  const b = await createFlagClient({ dryRun: true, runTag: 't2' }); // a fresh client
  for (let n = 0; n < 50; n++) {
    const id = `bot-test-${n}`;
    const first = await a.getLevelMode(id);
    assert.equal(await a.getLevelMode(id), first);   // same client, asked twice
    assert.equal(await b.getLevelMode(id), first);   // different client, same answer
    assert.ok(MODES.includes(first));
  }
  assert.equal(stableHash('bot-x-1'), stableHash('bot-x-1'));
});

test('3000 bots split roughly evenly across the 3 modes', async () => {
  const client = await createFlagClient({ dryRun: true, runTag: 'split' });
  const counts = { normal: 0, gentle_ramp: 0, practice_first: 0 };
  for (let n = 0; n < 3000; n++) counts[await client.getLevelMode(`bot-split-${n}`)]++;
  // Perfect would be 1000 each. Random noise is about +-26 (one standard deviation),
  // so 900..1100 is a very safe band.
  for (const mode of MODES) {
    assert.ok(counts[mode] > 900 && counts[mode] < 1100, `${mode}: ${counts[mode]}`);
  }
});

test('events are recorded with identifier and value', async () => {
  const client = await createFlagClient({ dryRun: true, runTag: 'ev' });
  await client.getLevelMode('bot-ev-1');
  client.track('bot-ev-1', 'reached_level_3');
  client.track('bot-ev-1', 'walls_passed', 23);
  await client.close();

  // The first event is the exposure that getLevelMode recorded.
  assert.equal(client.events[0].event, '$flag_exposure');
  assert.equal(client.events[0].identifier, 'bot-ev-1');
  assert.deepEqual(client.events[1], { event: 'reached_level_3', identifier: 'bot-ev-1', value: null });
  assert.deepEqual(client.events[2], { event: 'walls_passed', identifier: 'bot-ev-1', value: 23 });
  assert.deepEqual(client.stats, { exposures: 1, events: 2, fallbacks: 0 });
});

test('A/A mode: three arms, but every bot plays normal', async () => {
  const client = await createFlagClient({ dryRun: true, runTag: 'aa', aa: true });
  const arms = new Set();
  for (let n = 0; n < 300; n++) {
    const id = `bot-aa-${n}`;
    assert.equal(await client.getLevelMode(id), 'normal');
    arms.add(client.variantOf(id));
  }
  assert.equal(arms.size, 3); // still split into 3 groups, so we can compare them
});

test('real mode without a key falls back to normal and never throws', async () => {
  const saved = process.env.FLAGSMITH_SERVER_KEY;
  process.env.FLAGSMITH_SERVER_KEY = ''; // empty = "set" so loadEnv will not fill it from .env
  const originalWarn = console.warn;
  console.warn = () => {}; // keep the test output quiet
  try {
    const client = await createFlagClient({ dryRun: false, runTag: 'nokey' });
    assert.equal(client.online, false);
    assert.equal(await client.getLevelMode('bot-x'), 'normal');
    client.track('bot-x', 'rage_quit'); // must not throw
    await client.close();
    assert.equal(client.stats.fallbacks, 1);
  } finally {
    console.warn = originalWarn;
    if (saved === undefined) delete process.env.FLAGSMITH_SERVER_KEY;
    else process.env.FLAGSMITH_SERVER_KEY = saved;
  }
});
