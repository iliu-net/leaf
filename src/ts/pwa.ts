/**
 * pwa.ts — service worker registration & update logic
 *
 * Extracted from app.ts. Handles SW registration and manual update.
 * Used by app.ts at boot time and for the "Check for updates" menu item.
 *
 * Registration strategy:
 *   1. If a controller is already active, use getRegistration() to
 *      obtain the existing handle without triggering an update fetch.
 *   2. If no controller and we're offline, skip — register() would
 *      fail anyway because the browser needs to fetch sw.js.
 *   3. Otherwise call register() to install/update the SW.  When the
 *      server is unreachable the promise rejects, which we catch.
 */

let swRegistration: ServiceWorkerRegistration | null = null;

/** Attach update-found listener to an existing or new registration. */
function _listenForUpdates(reg: ServiceWorkerRegistration): void {
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    if (worker) {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          _notifyUpdateCallbacks();
        }
      });
    }
  });
}

/**
 * Register (or re-acquire) the service worker.
 * Call once at boot time.
 */
export async function initPwa(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  // Listen for messages from the SW (install status, etc.)
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'sw-installed') {
      console.log('[SW] Install complete —', event.data.jsCount, 'JS files cached');
    }
  });

  try {
    // 1. Already controlled — just grab the existing registration handle.
    if (navigator.serviceWorker.controller) {
      const existing = await navigator.serviceWorker.getRegistration();
      if (existing) {
        swRegistration = existing;
        console.log('[SW] Re-using active SW, scope:', existing.scope);
        _listenForUpdates(existing);
        return;
      }
    }

    // 2. Offline with no controller — nothing to do.
    if (!navigator.onLine) {
      console.log('[SW] Offline and no active SW — skipping registration');
      return;
    }

    // 3. Online, no controller — attempt fresh registration.
    const reg = await navigator.serviceWorker.register('sw.js');
    swRegistration = reg;
    console.log('[SW] Registered, scope:', reg.scope);
    _listenForUpdates(reg);
  } catch (err) {
    console.warn('[SW] Registration failed:', err);
  }
}

let _updateCallbacks: Array<(msg: string) => void> = [];

/** Notify all registered callbacks that an update is available. */
function _notifyUpdateCallbacks(): void {
  const msg = 'Update available — refresh to apply.';
  for (const cb of _updateCallbacks) cb(msg);
}

/**
 * Register a callback for when an update is found.
 * The callback receives a toast-friendly message.
 * Safe to call before or after initPwa().
 */
export function onUpdateFound(cb: (msg: string) => void): void {
  _updateCallbacks.push(cb);
}
