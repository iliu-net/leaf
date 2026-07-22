/**
 * ConfirmDialog.tsx — Styled confirmation dialog using @radix-ui/react-dialog.
 *
 * Phase 6f: replaces window.confirm(). Rendered in App.tsx alongside other
 *           modals, driven by state.confirmDialog.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useAppState } from '../state/AppContext.js';

export interface ConfirmDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ onConfirm, onCancel }: ConfirmDialogProps) {
  const { confirmDialog } = useAppState();

  return (
    <Dialog.Root open={confirmDialog.open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={`modal-content confirm-dialog${confirmDialog.variant === 'danger' ? ' danger' : ''}`}>
          <Dialog.Title asChild>
            <h2 className="modal-title">{confirmDialog.title}</h2>
          </Dialog.Title>
          <Dialog.Description asChild>
            <p className="modal-hint confirm-message">{confirmDialog.message}</p>
          </Dialog.Description>
          <div id="modal-actions">
            <Dialog.Close asChild>
              <button id="modal-cancel" type="button" className="btn">
                Cancel
              </button>
            </Dialog.Close>
            <button
              id="modal-create"
              type="button"
              className={`btn btn-primary${confirmDialog.variant === 'danger' ? ' btn-danger' : ''}`}
              onClick={onConfirm}
            >
              {confirmDialog.confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
