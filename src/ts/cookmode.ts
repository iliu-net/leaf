/**
 * cookmode.ts — Screen Wake Lock toggle
 *
 * Uses the Screen Wake Lock API to prevent the device screen from
 * dimming or sleeping while editing (e.g. following a recipe).
 *
 * Falls back gracefully on browsers that don't support the API
 * (Firefox, Safari, older browsers).
 *
 * Always starts OFF — the user must explicitly enable it each session
 * with a user gesture (button click).  No persistence.
 */

import { DOM, $maybe } from './dom-ids.js';

// ── State ──────────────────────────────────────────────────────────────────

let _wakeLock: WakeLockSentinel | null = null;
let _active = false;
let _visibilityHandler: (() => void) | null = null;

// ── Public API ─────────────────────────────────────────────────────────────

/** Whether cookmode is currently active (screen wake lock held). */
export function isActive(): boolean { return _active; }

/**
 * Request a screen wake lock.
 * Returns true on success, false if the API is unavailable or denied.
 */
export async function enable(): Promise<boolean> {
  if (!('wakeLock' in navigator)) {
    console.log('[cookmode] Screen Wake Lock API not available in this browser');
    return false;
  }

  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _active = true;
    console.log('[cookmode] Wake lock acquired');

    // The lock is released when the tab loses focus or the OS intervenes.
    _wakeLock.addEventListener('release', () => {
      _active = false;
      _wakeLock = null;
      console.log('[cookmode] Wake lock released (by OS or tab switch)');
      updateButton();
    });

    // Re-acquire the lock when the page becomes visible again (e.g.
    // user switches back to this tab).  Without this the lock stays
    // released after a visibility-change → release cycle.
    if (!_visibilityHandler) {
      _visibilityHandler = async () => {
        if (_active && document.visibilityState === 'visible' && !_wakeLock) {
          try {
            _wakeLock = await navigator.wakeLock.request('screen');
            console.log('[cookmode] Wake lock re-acquired after visibility change');
          } catch (err) {
            _active = false;
            _wakeLock = null;
            console.log('[cookmode] Failed to re-acquire wake lock:', (err as Error).message);
            updateButton();
          }
        }
      };
      document.addEventListener('visibilitychange', _visibilityHandler);
    }

    return true;
  } catch (err) {
    _active = false;
    _wakeLock = null;
    console.log('[cookmode] Failed to acquire wake lock:', (err as Error).message);
    return false;
  }
}

/**
 * Release the screen wake lock.
 * Safe to call even when cookmode is already off.
 */
export async function disable(): Promise<void> {
  _active = false;

  if (_visibilityHandler) {
    document.removeEventListener('visibilitychange', _visibilityHandler);
    _visibilityHandler = null;
  }

  if (_wakeLock) {
    await _wakeLock.release();
    _wakeLock = null;
    console.log('[cookmode] Wake lock released (user toggle)');
  }
}

/**
 * Toggle cookmode on/off.
 * Returns the new state.
 */
export async function toggle(): Promise<boolean> {
  if (_active) {
    await disable();
    return false;
  }
  return enable();
}

// ── DOM button sync ────────────────────────────────────────────────────────

/**
 * Update the cookmode toggle button to reflect the current state.
 * Safe to call even if the button isn't in the DOM yet.
 */
export function updateButton(): void {
  const btn = $maybe(DOM.BTN_COOKMODE) as HTMLButtonElement | null;
  if (!btn) return;
  btn.classList.toggle('active', _active);
  btn.title = _active ? 'Cookmode: ON — screen will stay awake' : 'Cookmode: OFF — click to keep screen awake';
}
