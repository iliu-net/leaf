/**
 * cross-tab.ts — multi-tab/window coordination via BroadcastChannel
 *
 * When a local mutation or server-sync change updates IndexedDB, the
 * change is broadcast to all other tabs of the same origin so they can
 * refresh their in-memory state and UI.
 *
 * Channel name is scoped to the app so it doesn't collide with other
 * BroadcastChannel users on the same origin.
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** Shape of the message sent between tabs. */
export interface CrossTabMessage {
  type: 'saved' | 'created' | 'deleted' | 'renamed' | 'server-sync';
  id: string;           // affected note id (old id for renames)
  newId?: string;       // new note id (only present for 'renamed')
}

type CrossTabListener = (msg: CrossTabMessage) => void;

// ── Imports ─────────────────────────────────────────────────────────────────

import { getNamespace } from './config.js';

// ── Channel setup ──────────────────────────────────────────────────────────

const _NS          = getNamespace();
const CHANNEL_NAME = _NS ? `leaf-notes-cross-tab:${_NS}` : 'leaf-notes-cross-tab';

let channel: BroadcastChannel | null = null;

/** Lazily create (or return existing) BroadcastChannel. */
function getChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
}

// ── Broadcasting ───────────────────────────────────────────────────────────

/**
 * Notify other tabs that a local mutation happened.
 * Called from the data layer (notes.ts) after any IndexedDB write.
 */
export function notifyLocalChange(
  type: CrossTabMessage['type'],
  id: string,
  newId?: string,
): void {
  try {
    getChannel().postMessage({ type, id, newId });
  } catch {
    // BroadcastChannel may not be available (e.g. Safari < 15.4).
    // Silently ignore — cross-tab sync is a progressive enhancement.
  }
}

/**
 * Notify other tabs that server changes were applied locally.
 * Called from sync.ts after applyServerChanges().
 */
export function notifyServerSync(): void {
  try {
    getChannel().postMessage({ type: 'server-sync', id: '' });
  } catch {
    // ignore
  }
}

// ── Listening ──────────────────────────────────────────────────────────────

/**
 * Register a listener for cross-tab change notifications.
 * Returns an unsubscribe function.
 */
export function onCrossTabChange(listener: CrossTabListener): () => void {
  const ch = getChannel();
  const handler = (event: MessageEvent<CrossTabMessage>) => {
    listener(event.data);
  };
  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
}
