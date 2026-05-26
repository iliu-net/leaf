/**
 * view.ts — SidebarView interface & shared event-handler types
 *
 * Pure type module — no runtime code, compiles to nothing in the bundle.
 * Separated so that future sidebar implementations (e.g. tag mode) can
 * implement SidebarView without importing ui.ts directly.
 */

import type { NoteMeta } from './store.js';

// ── Event handler callbacks ──────────────────────────────────────────────
// Moved here from ui.ts to avoid circular imports (both ui.ts and tree.ts
// need this type, and tree.ts needs to import from view.ts but not ui.ts).

export interface UIEventHandlers {
  onOpen:          (id: string) => void;
  onDelete:        (id: string) => void;
  onSearch:        (q: string) => void;
  onSave:          () => void;
  onNew:           () => void;
  onCreate:        () => void;
  onCancelModal:   () => void;
  onLogin:         (u: string, p: string) => void;
  onLogout:        () => void;
  onRename:        (id: string) => void;
  onRenameConfirm: (oldId: string) => void;
  onUpdateSW:      () => void;
  onResetDB:       () => void;
  onSignIn:        () => void;
  onDismissLogin:  () => void;
}

/** Handlers for raw-panel events. */
export interface RawEventHandlers {
  onInput: () => void;  // textarea input → dispatch note-changed
}

/** Handlers for meta-panel events. */
export interface MetaEventHandlers {
  onFieldChange: () => void;           // any meta field edited
  onAddCustomField: () => void;
  onRemoveCustomField: (key: string) => void;
}

// ── Sidebar view contract ───────────────────────────────────────────────

export interface SidebarView {
  /** Render the note list (flat or tree depending on implementation). */
  render(notes: NoteMeta[], currentId: string | null): void;

  /** Delegate a click event on the file-list to the view. */
  handleClick(e: MouseEvent, handlers: UIEventHandlers): void;

  /** Update the note count label in the sidebar footer. */
  updateNoteCount(total: number, shown: number): void;

  /** Tear down any ephemeral state (context menus, listeners, etc.). */
  destroy(): void;
}
