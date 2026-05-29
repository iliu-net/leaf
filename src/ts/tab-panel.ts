/**
 * tab-panel.ts — editor tab panel contract
 *
 * Every editor tab view (View, Raw, Meta) satisfies this interface so
 * editor-ctrl.ts can orchestrate them uniformly — the same pattern that
 * sidebar.ts uses with SidebarView.
 */

import type { NoteData } from './notes.js';

/** Context passed to a tab panel when it becomes active. */
export interface TabPanelContext {
  /** Raw note content (frontmatter + body), from the textarea. */
  content: string;
  /** Note metadata from IndexedDB. */
  noteData: NoteData;
}

/** Contract every editor tab panel must satisfy. */
export interface TabPanel {
  /** One-time DOM setup (cache refs). */
  init(): void;
  /**
   * Show / render the panel.
   * May be async — the markdown view lazily loads its parser.
   */
  show(ctx: TabPanelContext): void | Promise<void>;
  /** Hide the panel (called when switching away). */
  hide(): void;
  /**
   * Focus the panel's primary input element.
   * Called after the panel becomes active (switchTab, keyboard shortcut).
   * View tab has no focusable primary element and may omit this.
   */
  focus?(): void;
}
