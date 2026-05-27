/**
 * change-bus.ts — internal communication hub
 *
 * Single module that owns:
 *   1. Cross-tab broadcast  — BroadcastChannel to other tabs
 *   2. Local UI listeners    — subscribe() for in-tab refresh
 *
 * Server sync triggering is handled by sync.ts, which subscribes to
 * change-bus events (one-way dependency, no circular import).
 *
 * Replaces the scatter-shot pattern where notes.ts, trash-service.ts,
 * sync.ts, and app-files.ts each independently imported cross-tab.ts
 * to broadcast changes.
 */

import { getNamespace } from './config.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ChangeEvent {
  type: 'saved' | 'created' | 'deleted' | 'renamed' |
        'restored' | 'trash-emptied' | 'server-sync';
  id: string;
  newId?: string;
}

type Listener = (event: ChangeEvent) => void;

// ── BroadcastChannel (cross-tab) ───────────────────────────────────────────

const _NS          = getNamespace();
const CHANNEL_NAME = _NS ? `leaf-notes-change:${_NS}` : 'leaf-notes-change';

let _channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel {
  if (!_channel) _channel = new BroadcastChannel(CHANNEL_NAME);
  return _channel;
}

// ── Local listeners ────────────────────────────────────────────────────────

const _listeners: Listener[] = [];

/**
 * Subscribe to all change events — local mutations, cross-tab broadcasts,
 * and server-sync notifications all flow through this single API.
 *
 * Returns an unsubscribe function.
 */
export function subscribe(fn: Listener): () => void {
  _listeners.push(fn);
  return () => {
    const i = _listeners.indexOf(fn);
    if (i !== -1) _listeners.splice(i, 1);
  };
}

// ── Pending async listeners (for testability) ──────────────────────────────

const _pending: Promise<void>[] = [];

/** Wait for all pending async listener callbacks to settle. */
export function flush(): Promise<void> {
  return Promise.all(_pending).then(() => {});
}

// ── Incoming BroadcastChannel messages → local listeners ───────────────────

try {
  getChannel().addEventListener('message', (e: MessageEvent<ChangeEvent>) => {
    for (const fn of _listeners) fn(e.data);
  });
} catch {
  // BroadcastChannel not available (test environment, Safari < 15.4).
  // Cross-tab sync is progressive — the rest of the module still works.
}

// ── Publish ────────────────────────────────────────────────────────────────

/**
 * Publish a change event.
 *
 * Does two things:
 *   1. Broadcasts to other tabs via BroadcastChannel
 *   2. Notifies all local subscribe() listeners
 *
 * Note: triggering server sync is NOT done here.  sync.ts subscribes
 * to change-bus events and calls syncNow() for local-mutation types.
 * This avoids a circular import between change-bus.ts and sync.ts.
 */
export function publish(event: ChangeEvent): void {
  // Cross-tab broadcast (progressive enhancement — silently ignored if
  // BroadcastChannel is unavailable, e.g. Safari < 15.4).
  try {
    getChannel().postMessage(event);
  } catch { /* ignore */ }

  // Local listeners — track async listeners so tests can flush()
  for (const fn of _listeners) {
    const result = fn(event) as unknown;
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      const p = result as Promise<void>;
      _pending.push(p);
      p.finally(() => {
        const i = _pending.indexOf(p);
        if (i !== -1) _pending.splice(i, 1);
      });
    }
  }
}
