/**
 * context-menu.ts — Shared dropdown menu for tree, trash, and other views.
 *
 * Provides a generic context menu positioned near an anchor element.
 * The caller supplies the menu items — this module only handles
 * rendering, positioning, and outside-click dismissal.
 *
 * Module-level state:
 *   outsideListener — stored for cleanup on close
 */

import { DOM, $ } from './dom-ids.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface ContextMenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
}

// ── Module-level state ─────────────────────────────────────────────────────

let outsideListener: ((e: MouseEvent) => void) | null = null;

// ── DOM ref ────────────────────────────────────────────────────────────────

function getMenu(): HTMLElement {
  return $(DOM.CONTEXT_MENU);
}

// ── Public API ─────────────────────────────────────────────────────────────

export function show(anchorEl: HTMLElement, items: ContextMenuItem[]): void {
  const menu = getMenu();

  // Position near the anchor
  const rect = anchorEl.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom}px`;

  // Clear previous content and build new items
  menu.innerHTML = '';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = item.danger ? 'context-menu-item danger' : 'context-menu-item';
    btn.textContent = item.label;
    btn.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      item.action();
      close();
    };
    menu.appendChild(btn);
  }

  menu.classList.add('open');

  // Remove any stale outside-click listener before adding a new one
  if (outsideListener) {
    document.removeEventListener('click', outsideListener, true);
    outsideListener = null;
  }

  // Deferred via setTimeout(0) so the current click event finishes
  // propagating before we start listening.
  const listener = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      close();
    }
  };
  outsideListener = listener;
  setTimeout(() => {
    document.addEventListener('click', listener, true);
  }, 0);
}

export function close(): void {
  const menu = getMenu();
  menu.classList.remove('open');
  if (outsideListener) {
    document.removeEventListener('click', outsideListener, true);
    outsideListener = null;
  }
}
