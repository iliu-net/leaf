/**
 * Test setup — runs before every test file.
 *
 * 1. Installs fake-indexeddb so Dexie works without a real browser.
 * 2. Clears all IndexedDB tables between tests (not the whole DB, so the
 *    Dexie instance stays alive).
 *
 * Note: db.ts now imports Dexie directly via ES import — no need for
 * window.Dexie hack.
 */

import 'fake-indexeddb/auto';
import Dexie from 'dexie';

// spy on console methods so tests can assert on warnings/errors
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

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
