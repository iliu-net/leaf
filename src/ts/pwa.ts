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
 * Force an update check, skip waiting, and reload.
 * Called from the "Check for updates" menu item.
 * Returns the toast message strings so the caller (app.ts) can display them.
 */
export async function updateApp(): Promise<{ ok: boolean; message: string }> {
  if (!swRegistration) {
    return { ok: false, message: 'No service worker registration found' };
  }

  try {
    await swRegistration.update();

    // If a new worker is installing, wait for it to finish
    if (swRegistration.installing) {
      await new Promise<void>(resolve => {
        swRegistration!.installing!.addEventListener('statechange', () => {
          if (swRegistration?.installing?.state === 'installed') {
            resolve();
          }
        });
      });

      // Tell the waiting worker to activate immediately
      swRegistration.active?.postMessage({ action: 'SKIP_WAITING' });
    }

    location.reload();
    return { ok: true, message: '' };
  } catch (err) {
    return { ok: false, message: `Update failed: ${(err as Error).message}` };
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
