// Flagsmith adapter for the browser game (human players).
//
// main.js only calls:
//   await initFlags(playerId)   once, when the page loads
//   getLevelMode()              when Level 1 is built -> 'normal' | 'gentle_ramp' | 'practice_first'
//   track(eventName, value)     when something worth measuring happens
//   await flush()               when a session ends (we also flush on 'pagehide')
//   isOnline()                  true if we are really talking to Flagsmith
//
// If there is no VITE_FLAGSMITH_CLIENT_KEY (or Flagsmith can't be reached) we go OFFLINE:
// everyone plays 'normal' and track() does nothing. Nothing in here ever throws.

import flagsmith from '@flagsmith/flagsmith';
import { FLAG, MODES } from '../../engine/constants.js';

// Vite copies variables that start with VITE_ from .env into the browser bundle.
// The CLIENT-side key is meant to be public, so this is safe. Never put the server key here.
const CLIENT_KEY = import.meta.env?.VITE_FLAGSMITH_CLIENT_KEY; // "?." so the file also loads outside Vite

let online = false;

// A random id for this browser, kept in localStorage so a reload is the same player.
export function getOrCreatePlayerId() {
  try {
    let id = localStorage.getItem('levelup_player_id');
    if (!id) {
      id = 'human-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('levelup_player_id', id);
    }
    return id;
  } catch {
    return 'human-' + Math.random().toString(36).slice(2, 10); // private mode etc.
  }
}

export async function initFlags(playerId) {
  if (!CLIENT_KEY) {
    console.info('[flags] No VITE_FLAGSMITH_CLIENT_KEY: offline mode, everyone plays "normal".');
    return;
  }
  try {
    await flagsmith.init({
      environmentID: CLIENT_KEY,
      enableEvents: true, // REQUIRED for getExperimentFlag to record exposures and for trackEvent
    });
    // Exposures and conversions are joined per identity, so identify BEFORE reading the flag.
    await flagsmith.identify(playerId);
    online = true;
    // Send buffered events when the tab is hidden or closed.
    window.addEventListener('pagehide', () => { flagsmith.flushEvents(); });
  } catch (err) {
    console.warn('[flags] Flagsmith unavailable, offline mode:', err?.message || err);
    online = false;
  }
}

export function isOnline() {
  return online;
}

export function getLevelMode() {
  if (!online) return 'normal';
  try {
    // Reads the flag AND records the exposure (if this player is enrolled in the experiment).
    const flag = flagsmith.getExperimentFlag(FLAG);
    if (flag && flag.enabled && MODES.includes(flag.value)) return flag.value;
  } catch (err) {
    console.warn('[flags] getExperimentFlag failed:', err?.message || err);
  }
  return 'normal';
}

export function track(eventName, value) {
  if (!online) return;
  try {
    // The SDK fills in the identifier from identify(). value is optional (numbers OK).
    flagsmith.trackEvent(eventName, value === undefined ? undefined : { value });
  } catch (err) {
    console.warn('[flags] trackEvent failed:', err?.message || err);
  }
}

export async function flush() {
  if (!online) return;
  try {
    await flagsmith.flushEvents();
  } catch {
    // flushEvents never rejects, but stay safe
  }
}
