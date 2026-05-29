/**
 * modal.ts — create/rename modal logic
 *
 * Owns the new-note/rename modal DOM, extracted from ui.ts.
 * All modal state (including _renameId) lives here.
 */

// ── DOM refs ──────────────────────────────────────────────────────────────

import { DOM, $, $maybe } from './dom-ids.js';

const overlay      = $(DOM.MODAL_OVERLAY);
const modalTitle   = $(DOM.MODAL_TITLE);
const modalInput   = $(DOM.MODAL_INPUT) as HTMLInputElement;
const modalHint    = $(DOM.MODAL_HINT);
const modalCreate  = $(DOM.MODAL_CREATE);
const modalCancel  = $(DOM.MODAL_CANCEL);

// ── State ─────────────────────────────────────────────────────────────────

/** Non-null when the modal is in rename mode (holds the id being renamed). */
let _renameId: string | null = null;

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Open the create-note modal.
 * @param currentNoteId  ID of the currently open note (for deriving path prefix)
 * @param searchValue    Current search input value (for pre-filling name)
 */
export function openModal(currentNoteId: string | null, searchValue: string): void {
  _renameId = null;
  modalTitle.textContent = 'New note';

  const searchVal = searchValue || '';
  let prefix = '';

  if (currentNoteId) {
    const lastColon = currentNoteId.lastIndexOf(':');
    if (lastColon !== -1) {
      prefix = currentNoteId.substring(0, lastColon + 1);
    }
  }

  modalInput.value = prefix + searchVal;
  modalHint.textContent = '';
  modalHint.className = 'modal-hint';
  if (modalCreate) modalCreate.textContent = 'Create';
  overlay.classList.add('open');
  requestAnimationFrame(() => modalInput.focus());
}

/**
 * Open the modal in rename mode.
 * @param id  current note id being renamed
 */
export function openRenameModal(id: string): void {
  _renameId = id;
  modalTitle.textContent = 'Rename note';
  modalInput.value = id;
  modalInput.select();
  modalHint.textContent = '';
  modalHint.className = 'modal-hint';
  if (modalCreate) modalCreate.textContent = 'Rename';
  overlay.classList.add('open');
  requestAnimationFrame(() => modalInput.focus());
}

/** Close the modal and clear state. */
export function closeModal(): void {
  _renameId = null;
  overlay.classList.remove('open');
}

/** Show an error message in the modal hint. */
export function setModalError(msg: string): void {
  modalHint.textContent = msg;
  modalHint.className = 'modal-hint err';
}

/** Show an informational hint in the modal. */
export function setModalHint(msg: string): void {
  modalHint.textContent = msg;
  modalHint.className = 'modal-hint';
}

/** Get the current trimmed modal input value. */
export function getModalValue(): string {
  return modalInput.value.trim();
}

/** True if the modal is currently in rename mode. */
export function isRenameMode(): boolean {
  return _renameId !== null;
}

/** Get the id being renamed (null if in create mode). */
export function getRenameId(): string | null {
  return _renameId;
}

// ── Event binding ────────────────────────────────────────────────────────

export interface ModalEventHandlers {
  onCreate: () => void;
  onCancel: () => void;
  onRenameConfirm: (oldId: string) => void;
}

/**
 * Wire modal DOM events to handlers.
 */
export function bindModalEvents(handlers: ModalEventHandlers): void {
  // Create / rename button
  modalCreate.addEventListener('click', () => {
    if (_renameId) handlers.onRenameConfirm(_renameId);
    else           handlers.onCreate();
  });
  modalCancel.addEventListener('click', handlers.onCancel);

  // Keyboard: Enter to confirm
  modalInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if (_renameId) handlers.onRenameConfirm(_renameId);
      else           handlers.onCreate();
    }
  });

  // Escape key on document — close modal if open
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) {
      handlers.onCancel();
    }
  });

  // Click outside → cancel
  overlay.addEventListener('click', e => {
    if (e.target === overlay) handlers.onCancel();
  });
}
