// Small helper for talking to the Flagsmith Admin (Management) REST API.
// Used by scripts/setup-flagsmith.mjs and scripts/fetch-results.mjs.
//
// Plain Node 20: we use the built-in fetch(), no extra packages.
//
// Safety rules in this file:
//   - Keys are read from process.env (filled from .env by loadEnv) and are NEVER printed.
//   - Any text we print that came back from the server goes through redact() first,
//     just in case it echoes a key back.
//   - Any HTTP error stops the script with a clear message (status + the API's own error text).
//
// Where the details come from (Flagsmith source, cloned at /home/claude/src/fs):
//   - Header "Authorization: Api-Key <key>": docs/.../management-api/authentication.md lines 28-33,
//     and api/api_keys/authentication.py (MasterAPIKeyAuthentication uses rest_framework_api_key's KeyParser).
//   - Base URL for Flagsmith Cloud: https://api.flagsmith.com/ (+ api/v1/), same doc, line 39.

import { loadEnv } from '../bots/flags.mjs';

export const DEFAULT_API_URL = 'https://api.flagsmith.com/api/v1/';

// ---------------------------------------------------------------------------
// 1. Command-line options
//    parseArgs(['--label', 'aa', '--start']) -> { label: 'aa', start: true }
//    A flag followed by a value that does not start with "--" takes that value.
// ---------------------------------------------------------------------------
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[name] = next;
      i++;
    } else {
      out[name] = true;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Settings from .env
//    envKeyVar = the NAME of the variable that holds the environment key
//    (FLAGSMITH_ENVIRONMENT_KEY for Production, FLAGSMITH_ENVIRONMENT_KEY_AA for the A/A check).
//
//    IMPORTANT: the Admin API finds an environment by its CLIENT-SIDE key
//    (the "Environment ID", e.g. "aBcD1234..."), NOT by the server-side "ser." key.
//    Evidence: api/environments/views.py `NestedEnvironmentViewSet._get_environment`
//    looks up Environment.objects.get(api_key=...), and Environment.api_key is the client key;
//    "ser." keys are a different model (api/environments/api_keys.py, SERVER_API_KEY_PREFIX).
// ---------------------------------------------------------------------------
export function readConfig({ envKeyVar = 'FLAGSMITH_ENVIRONMENT_KEY', env = process.env, needAdminKey = true } = {}) {
  const problems = [];
  const adminKey = env.FLAGSMITH_ADMIN_API_KEY || '';
  let apiUrl = env.FLAGSMITH_API_URL || DEFAULT_API_URL;
  if (!apiUrl.endsWith('/')) apiUrl += '/';

  let envKey = env[envKeyVar] || '';
  let envKeySource = envKeyVar;
  // Convenience: for Production, the client key in VITE_FLAGSMITH_CLIENT_KEY is the same value.
  if (!envKey && envKeyVar === 'FLAGSMITH_ENVIRONMENT_KEY' && env.VITE_FLAGSMITH_CLIENT_KEY) {
    envKey = env.VITE_FLAGSMITH_CLIENT_KEY;
    envKeySource = 'VITE_FLAGSMITH_CLIENT_KEY';
  }

  if (needAdminKey && !adminKey) {
    problems.push('FLAGSMITH_ADMIN_API_KEY is not set. Create one in Organisation Settings > API Access > Create API Key (tick "Is admin").');
  }
  if (!envKey) {
    problems.push(`${envKeyVar} is not set. Paste the environment's CLIENT-SIDE key (Environment Settings > Keys, the short "Environment ID").`);
  } else if (envKey.startsWith('ser.')) {
    problems.push(`${envKeySource} holds a server-side "ser." key. The Admin API needs the CLIENT-SIDE environment key (the short Environment ID) instead.`);
  }
  if (adminKey.startsWith('ser.')) {
    problems.push('FLAGSMITH_ADMIN_API_KEY holds an environment "ser." key. It must be an ORGANISATION API key (Organisation Settings > API Access).');
  }

  const projectId = env.FLAGSMITH_PROJECT_ID ? Number(env.FLAGSMITH_PROJECT_ID) : null;
  if (env.FLAGSMITH_PROJECT_ID && !Number.isInteger(projectId)) {
    problems.push('FLAGSMITH_PROJECT_ID must be a number (it is in the dashboard URL: /project/<number>/...).');
  }

  return { adminKey, apiUrl, envKey, envKeySource, envKeyVar, projectId, problems };
}

// Load .env (never overwrites variables that are already set) and read the settings.
export function loadConfig(options) {
  loadEnv();
  return readConfig(options);
}

// ---------------------------------------------------------------------------
// 3. Building a request (pure: no network). Tests check this.
//    path is relative to the API root, e.g. "environments/<key>/experiments/".
// ---------------------------------------------------------------------------
export function buildRequest(cfg, method, path, body) {
  const url = new URL(path, cfg.apiUrl).toString();
  const headers = {
    Authorization: `Api-Key ${cfg.adminKey}`,
    Accept: 'application/json',
  };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return { url, init };
}

// Replace every secret in a piece of text with "***".
export function redact(text, cfg) {
  let out = String(text ?? '');
  for (const secret of [cfg?.adminKey, cfg?.envKey]) {
    if (secret && secret.length >= 4) out = out.split(secret).join('***');
  }
  return out;
}

// A path that is safe to print: the environment key is replaced by a label.
export function printablePath(path, cfg) {
  return cfg?.envKey ? path.split(cfg.envKey).join(`<${cfg.envKeySource}>`) : path;
}

// One line describing a planned request, for --dry-print. Never shows keys.
export function describeRequest(cfg, method, path, body) {
  // Plain string join (not new URL) so placeholders like <feature id> stay readable.
  const line = `${method.padEnd(6)} ${cfg.apiUrl}${printablePath(path, cfg)}`;
  return body === undefined ? line : `${line}\n       body: ${JSON.stringify(body)}`;
}

// The error we throw on any HTTP problem. main() prints it and exits with code 1.
export class ApiError extends Error {
  constructor(message, { status, body, retryAfter } = {}) {
    super(message);
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

// ---------------------------------------------------------------------------
// 4. Sending a request.
//    Returns the parsed JSON (or null for an empty body).
//    Throws ApiError with status + the API's error body (secrets removed) on any non-2xx.
// ---------------------------------------------------------------------------
export async function api(cfg, method, path, body, { fetchImpl = fetch } = {}) {
  const { url, init } = buildRequest(cfg, method, path, body);
  const where = `${method} ${printablePath(path, cfg)}`;
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    throw new ApiError(`Could not reach Flagsmith at ${new URL(cfg.apiUrl).host} (${where}): ${redact(err.message, cfg)}. Check your internet connection and FLAGSMITH_API_URL.`);
  }
  const text = await res.text();
  if (!res.ok) {
    const shortBody = redact(text, cfg).slice(0, 1500) || '(empty body)';
    throw new ApiError(`${where} failed with HTTP ${res.status}.\n      API said: ${shortBody}\n      ${hintFor(res.status)}`, {
      status: res.status,
      body: shortBody,
      retryAfter: res.headers?.get?.('retry-after') ?? null,
    });
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// A plain-English hint for common status codes.
export function hintFor(status) {
  switch (status) {
    case 401: return 'Hint: the Admin API key was not accepted. Check FLAGSMITH_ADMIN_API_KEY (Organisation Settings > API Access).';
    case 403: return 'Hint: no permission, or the environment key is wrong. The key must be the CLIENT-SIDE environment key, the API key must be an admin key, and Experimentation must be enabled for the organisation.';
    case 404: return 'Hint: not found. Check FLAGSMITH_PROJECT_ID and the environment key.';
    case 409: return 'Hint: it already exists (for example an active experiment on this flag). Re-run the script; it looks for existing objects first.';
    case 429: return 'Hint: too many requests, or a refresh was asked for less than 5 minutes ago. Wait and try again.';
    default: return status >= 500 ? 'Hint: Flagsmith had a server error. Wait a minute and try again.' : 'Hint: read the API message above; it names the field that is wrong.';
  }
}

// List endpoints sometimes return a plain array and sometimes a page: { count, next, results: [...] }.
// This returns every item, following "next" links if there are more pages.
export async function listAll(cfg, path, options) {
  const items = [];
  let page = await api(cfg, 'GET', path, undefined, options);
  for (let guard = 0; guard < 50; guard++) {
    if (Array.isArray(page)) return items.concat(page);
    items.push(...(page?.results ?? []));
    if (!page?.next) return items;
    // "next" is a full URL; turn it back into a path relative to the API root.
    const next = new URL(page.next);
    const basePath = new URL(cfg.apiUrl).pathname; // e.g. "/api/v1/"
    let nextPath = next.pathname + next.search;
    if (nextPath.startsWith(basePath)) nextPath = nextPath.slice(basePath.length);
    page = await api(cfg, 'GET', nextPath, undefined, options);
  }
  return items;
}

// Print an error and stop. Used by both scripts' main().
export function fail(message, cfg) {
  console.error(`\nFAIL  ${redact(message, cfg)}`);
  process.exit(1);
}
