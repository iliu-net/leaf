/**
 * EditorWrap.tsx — Editor area orchestrator.
 *
 * Phase 4c: empty state, tab bar, ViewTab, CodeTab, and MetaTab all wired.
 * Phase 6d: tab bar migrated to @radix-ui/react-tabs.
 *   - Tabs.Root / Tabs.List / Tabs.Trigger / Tabs.Content replace
 *     manual role="tablist" / role="tab" / role="tabpanel".
 *   - keyboard nav (arrow keys, Home, End) handled by Radix.
 *   - .active class replaced by [data-state="active"] attribute.
 */

import { useCallback } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useAppState, useAppDispatch } from '../state/AppContext.js';
import ViewTab from './ViewTab.js';
import CodeTab from './CodeTab.js';
import MetaTab from './MetaTab.js';
import TrashPreview from './TrashPreview.js';

export default function EditorWrap() {
  const dispatch = useAppDispatch();
  const { activeNoteId, activeTab, isSystemNote, trashPreview } = useAppState();

  const hasNote = activeNoteId !== null;

  const switchTab = useCallback(
    (value: string) => {
      if (value === 'view' || value === 'code' || value === 'meta') {
        dispatch({ type: 'SET_ACTIVE_TAB', tab: value });
      }
    },
    [dispatch],
  );

  return (
    <main id="editor-wrap">
      {/* ── Trash preview ── */}
      {trashPreview && <TrashPreview />}

      {/* ── Empty state ── */}
      {!trashPreview && !hasNote && (
        <div id="empty-state" aria-label="No note selected">
          <div className="empty-icon" aria-hidden="true">
            <svg width="22" height="22" fill="none" stroke="currentColor"
                 strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M9 12h6m-6 4h6m2 4H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l5 5v11a2 2 0 0 1-2 2z"/>
            </svg>
          </div>
          <p>Select a note or create a new one</p>
          <small><kbd>Ctrl S</kbd> save</small>
        </div>
      )}

      {/* ── Tab bar + panels (Radix Tabs) ── */}
      {!trashPreview && hasNote && (
        <Tabs.Root className="editor-tabs-root" value={activeTab} onValueChange={switchTab}>
          <Tabs.List id="editor-tabs" aria-label="Editor tabs">
            <Tabs.Trigger value="view" id="tab-btn-view" className="tab-btn">
              View
            </Tabs.Trigger>
            <Tabs.Trigger
              value="code"
              id="tab-btn-code"
              className="tab-btn"
              style={{ display: isSystemNote ? 'none' : '' }}
            >
              Code
            </Tabs.Trigger>
            <Tabs.Trigger value="meta" id="tab-btn-meta" className="tab-btn">
              Meta
            </Tabs.Trigger>
          </Tabs.List>

          {/* Code tab — always mounted (CM is expensive to recreate) */}
          <Tabs.Content value="code" id="tab-code" className="tab-panel" forceMount>
            <CodeTab />
          </Tabs.Content>

          {/* View tab — conditionally rendered inside (re-render on entry) */}
          <Tabs.Content value="view" id="tab-view" className="tab-panel" forceMount>
            {activeTab === 'view' && <ViewTab />}
          </Tabs.Content>

          {/* Meta tab — always mounted */}
          <Tabs.Content value="meta" id="tab-meta" className="tab-panel" forceMount>
            <MetaTab />
          </Tabs.Content>
        </Tabs.Root>
      )}
    </main>
  );
}
