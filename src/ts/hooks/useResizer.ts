/**
 * useResizer.ts — Sidebar drag-resize hook.
 *
 * Ports the mousedown/mousemove/mouseup drag logic from sidebar.ts.
 * Returns refs for the sidebar container and resizer handle, plus the
 * current width.  Persists width to localStorage on drag end.
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import { sidebarWidth } from '../local-store.js';

const MIN = 120;
const MAX = 500;

/** Persisted width from localStorage, clamped to [MIN, MAX]. */
function getInitialWidth(): number {
  const saved = sidebarWidth.get();
  if (saved) {
    const w = Math.min(MAX, Math.max(MIN, Number(saved)));
    if (!Number.isNaN(w)) return w;
  }
  return 220; // default
}

export function useResizer() {
  const [width, setWidth] = useState(getInitialWidth);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const applyWidth = useCallback((w: number) => {
    const clamped = Math.min(MAX, Math.max(MIN, w));
    setWidth(clamped);
    // Set CSS custom property on the #app container for CSS-driven layout
    const app = document.getElementById('app');
    if (app) {
      app.style.setProperty('--sidebar-w', `${clamped}px`);
    }
  }, []);

  // Apply initial width on mount
  useEffect(() => {
    applyWidth(getInitialWidth());
  }, [applyWidth]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    dragging.current = true;
    startX.current = e.clientX;
    startW.current = sidebar.getBoundingClientRect().width;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const dx = ev.clientX - startX.current;
      applyWidth(startW.current + dx);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);

      const w = sidebar.getBoundingClientRect().width;
      sidebarWidth.set(w);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp, { once: true });
  }, [applyWidth]);

  return {
    /** Current sidebar width in px. */
    width,
    /** Ref to attach to the sidebar container (optional — width is applied via CSS var). */
    containerRef,
    /** mousedown handler for the resizer handle element. */
    onMouseDown,
  };
}
