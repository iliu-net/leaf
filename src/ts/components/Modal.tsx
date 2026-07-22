/**
 * Modal.tsx — New-note / rename modal dialog.
 *
 * Phase 3: controlled component — open/closed via props, managed by AppContext.
 * Phase 6: replaced custom <div> overlay with @radix-ui/react-dialog.
 *   - Escape key, overlay click, and focus trap handled by Radix.
 *   - Keeps the same CSS IDs (#modal-title, #modal-input, #modal-hint,
 *     #modal-actions, etc.) for visual parity.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

export interface ModalProps {
  open: boolean;
  mode: 'create' | 'rename';
  noteId?: string;
  defaultValue?: string;
  error?: string;
  onClose: () => void;
  onSubmit: (value: string) => void;
}

export default function Modal({ open, mode, noteId, defaultValue, error, onClose, onSubmit }: ModalProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Pre-fill when modal opens (controlled input — no ref timing issues)
  useEffect(() => {
    if (open) {
      setValue(mode === 'rename' ? (noteId || '') : (defaultValue || ''));
    }
  }, [open, mode, noteId, defaultValue]);

  // Select all text in rename mode once the input is in the DOM
  useEffect(() => {
    if (open && mode === 'rename' && inputRef.current) {
      // Small delay to let Radix finish its focus placement
      const id = setTimeout(() => inputRef.current?.select(), 0);
      return () => clearTimeout(id);
    }
  }, [open, mode]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }, [value, onSubmit]);

  const title = mode === 'rename' ? 'Rename note' : 'New note';
  const actionLabel = mode === 'rename' ? 'Rename' : 'Create';

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content">
          <Dialog.Title asChild>
            <h2 className="modal-title">{title}</h2>
          </Dialog.Title>

          <form onSubmit={handleSubmit}>
            <div className="modal-field">
              <label htmlFor="modal-input">Name</label>
              <input
                ref={inputRef}
                id="modal-input"
                type="text"
                placeholder="my-note"
                maxLength={80}
                autoComplete="off"
                spellCheck={false}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <Dialog.Description asChild>
              <p className="modal-hint">{error || ''}</p>
            </Dialog.Description>
            <div id="modal-actions">
              <Dialog.Close asChild>
                <button id="modal-cancel" type="button" className="btn">
                  Cancel
                </button>
              </Dialog.Close>
              <button id="modal-create" type="submit" className="btn btn-primary">
                {actionLabel}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
