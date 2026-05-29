/**
 * edit-time.ts — note editing time tracking
 *
 * Tracks active editing seconds per note.  A 1-second interval increments
 * a counter while the user is active (keystrokes, meta-field edits).
 * Pauses after a configurable inactivity timeout (default 5 min).
 *
 * The accumulated value is persisted into the frontmatter under the
 * reserved key `edit-time` — but only alongside real content saves,
 * never on its own.  This prevents version pollution on the server.
 *
 * Pattern follows cookmode.ts: clean module with private state and a
 * small public API.
 */

import { nowSec } from './utils.js';

// ── State ──────────────────────────────────────────────────────────────────

let _noteId: string | null = null;
let _accumulatedSec = 0;
let _lastActivitySec = 0;
let _running = false;
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _inactivityTimeoutSec = 300; // 5 min default, overridden via config

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Start tracking edit time for a note.
 *
 * @param noteId          The note being edited.
 * @param existingSeconds  Previously accumulated seconds from frontmatter.
 * @param inactivitySec   Inactivity timeout override (from SpaConfig).
 */
export function start(
  noteId: string,
  existingSeconds: number,
  inactivitySec?: number,
): void {
  _noteId = noteId;
  _accumulatedSec = existingSeconds;
  _lastActivitySec = nowSec();
  _running = true;
  if (inactivitySec !== undefined) _inactivityTimeoutSec = inactivitySec;

  if (_intervalId !== null) clearInterval(_intervalId);
  _intervalId = setInterval(_tick, 1000);
}

/**
 * Signal user activity — resets the inactivity timer.
 * Call on every keystroke, meta-field change, or tab switch.
 */
export function noteActivity(): void {
  _lastActivitySec = nowSec();
  if (!_running && _noteId !== null) {
    _running = true; // resume after an inactivity pause
  }
}

/**
 * Stop tracking and return the final accumulated seconds.
 * Does NOT persist — the caller decides whether to save.
 */
export function stop(): number {
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _running = false;
  const sec = _accumulatedSec;
  _noteId = null;
  _accumulatedSec = 0;
  return sec;
}

/**
 * Non-destructive read of current accumulated seconds.
 * Use when merging edit-time into frontmatter before a save.
 */
export function getCurrentSeconds(): number {
  return _accumulatedSec;
}

// ── Internal ───────────────────────────────────────────────────────────────

function _tick(): void {
  if (!_running || _noteId === null) return;

  const now = nowSec();
  if (now - _lastActivitySec > _inactivityTimeoutSec) {
    _running = false; // pause — user walked away
    return;
  }

  _accumulatedSec++;
}
