/**
 * Test setup — runs before every test file.
 *
 * 1. Installs fake-indexeddb so Dexie works without a real browser.
 * 2. Clears all IndexedDB tables between tests (not the whole DB, so the
 *    Dexie instance stays alive).
 * 3. Registers jest-dom matchers (toBeInTheDocument etc.) globally.
 * 4. Polyfills browser APIs missing in jsdom (ResizeObserver, PointerEvent).
 *
 * Note: db.ts now imports Dexie directly via ES import — no need for
 * window.Dexie hack.
 */

import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import Dexie from 'dexie';

// ── Browser API polyfills (for React + Radix UI) ─────────────────────────

// ResizeObserver — used by Radix components (context menu, dropdown, etc.)
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    /** @type {(entries: any[]) => void} */
    _callback;
    /**
     * @param {(entries: any[]) => void} callback
     */
    constructor(callback) {
      this._callback = callback;
    }
    /** @param {Element} _el */
    observe(_el) {
      // Fire after a tick so the callback runs after React commits the
      // effect (avoiding setHeight(el.clientHeight) overriding the value).
      Promise.resolve().then(() => {
        this._callback([{ contentRect: { height: 600, width: 200 } }]);
      });
    }
    unobserve() {}
    disconnect() {}
  };
}

// PointerEvent — used by Radix context menu / dropdown interactions
if (!globalThis.PointerEvent) {
  globalThis.PointerEvent = class PointerEvent extends MouseEvent {
    /** @type {string} */
    pointerType;
    /**
     * @param {string} type
     * @param {PointerEventInit} [init]
     */
    constructor(type, init) {
      super(type, init);
      this.pointerType = init?.pointerType ?? 'mouse';
    }
  };
}

// ── Console spies ────────────────────────────────────────────────────────

// spy on console methods so tests can assert on warnings/errors
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ── DB cleanup ───────────────────────────────────────────────────────────

afterEach(async () => {
  // Clear all tables instead of deleting the whole DB — this keeps the
  // Dexie instance alive for the next test.  Module-level Dexie instances
  // (like `db` in db.js) hold a connection that becomes unusable after
  // the database is deleted.
  const db = new Dexie('notes-app');
  try {
    await db.open();
    await db.table('notes').clear();
    await db.table('queue').clear();
    db.close();
  } catch {
    // Table might not exist yet, that's fine
  }
  vi.restoreAllMocks();
});
