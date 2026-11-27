// Runs every test/*.test.js file with Node's built-in test runner.
// (Listing the files ourselves works the same on Windows, macOS and Linux.)
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = readdirSync('test').filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
