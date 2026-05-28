/**
 * pwa.ts — service worker registration & update logic
 *
 * Extracted from app.ts. Handles SW registration and manual update.
 * Used by app.ts at boot time and for the "Check for updates" menu item.
 */

let swRegistration: ServiceWorkerRegistration | null = null;

/**
 * Register the service worker and listen for updates.
 * Call once at boot time.
 */
export async function initPwa(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    swRegistration = reg;
    console.log('[SW] Registered, scope:', reg.scope);

    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (worker) {
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            // Let the caller decide how to notify the user
            // (app.ts hooks into this via the toast callback or a callback pattern)
          }
        });
      }
    });
  } catch (err) {
    console.warn('[SW] Registration failed:', err);
  }
}

/**
 * Register a callback for when an update is found.
 * The callback receives a toast-friendly message.
 */
export function onUpdateFound(cb: (msg: string) => void): void {
  if (!swRegistration) return;

  swRegistration.addEventListener('updatefound', () => {
    const worker = swRegistration?.installing;
    if (worker) {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          cb('Update available — refresh to apply.');
        }
      });
    }
  });
}
