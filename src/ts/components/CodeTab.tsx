/**
 * CodeTab.tsx — CodeMirror editor tab.
 *
 * Phase 4b: lazy-loads createEditor from setup.ts, wraps it in a
 *           useRef + useEffect pattern.  Title input at top writes
 *           to frontmatter.  CM body merges with frontmatter on
 *           every change.  Shows an error if CM fails to load.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppState } from '../state/AppContext.js';
import { useNotes } from '../hooks/useNotes.js';
import { parseFrontmatter, updateFrontmatter } from '../frontmatter.js';
import type { CMView } from '../codemirror/setup.js';

/** Replace the body portion of raw content (after frontmatter) with new body. */
function replaceBody(rawContent: string, newBody: string): string {
  const m = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) return m[0] + newBody;
  return newBody;
}

export default function CodeTab() {
  const { activeNoteContent } = useAppState();
  const { setContent } = useNotes();

  const containerRef = useRef<HTMLDivElement>(null);
  const cmRef = useRef<CMView | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const isInternal = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Stable refs so the CM change handler (registered once on mount)
  // always reads the latest values without stale closures.
  const contentRef = useRef(activeNoteContent);
  contentRef.current = activeNoteContent;
  const setContentRef = useRef(setContent);
  setContentRef.current = setContent;

  // ── CM change handler (stable — no deps that change) ──
  const handleCMChange = useCallback(() => {
    if (!cmRef.current) return;
    const body = cmRef.current.state.doc.toString();
    const raw = contentRef.current || '';
    const merged = replaceBody(raw, body);
    if (merged !== raw) {
      isInternal.current = true;
      setContentRef.current(merged);
    }
  }, []);

  // ── Title change handler ──
  const handleTitleChange = useCallback(() => {
    const title = titleRef.current?.value.trim() || '';
    const raw = contentRef.current || '';
    const fm = parseFrontmatter(raw);
    const curTitle = typeof fm.meta['title'] === 'string' ? fm.meta['title'] : '';
    if (title === curTitle) return;
    isInternal.current = true;
    setContentRef.current(updateFrontmatter(raw, { title: title || undefined }));
  }, []);

  // ── Create CM on mount ──
  useEffect(() => {
    let cancelled = false;

    import('../codemirror/setup.js')
      .then(mod => {
        if (cancelled || !containerRef.current) return;
        const raw = contentRef.current || '';
        const fm = parseFrontmatter(raw);
        cmRef.current = mod.createEditor(containerRef.current, fm.body, handleCMChange);

        // Populate title input
        if (titleRef.current) {
          titleRef.current.value = typeof fm.meta['title'] === 'string' ? fm.meta['title'] as string : '';
        }
      })
      .catch(err => {
        if (!cancelled) {
          console.error('[CodeTab] CM load failed:', err);
          setLoadError('CodeMirror failed to load. Please reload the page.');
        }
      });

    return () => {
      cancelled = true;
      cmRef.current?.destroy();
      cmRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync external content changes → CM + title ──
  useEffect(() => {
    // Skip if this change originated from within CodeTab itself
    if (isInternal.current) {
      isInternal.current = false;
      return;
    }
    // activeNoteContent is string | null.  An empty note has content "" —
    // that's a valid value we must sync (clears CM).  Only bail on null.
    if (activeNoteContent === null || !cmRef.current) return;

    const fm = parseFrontmatter(activeNoteContent);

    // Sync CM body
    const currentBody = cmRef.current.state.doc.toString();
    if (fm.body !== currentBody) {
      cmRef.current.dispatch({
        changes: { from: 0, to: cmRef.current.state.doc.length, insert: fm.body },
      });
    }

    // Sync title input
    if (titleRef.current) {
      const title = typeof fm.meta['title'] === 'string' ? fm.meta['title'] : '';
      if (titleRef.current.value !== title) {
        titleRef.current.value = title;
      }
    }
  }, [activeNoteContent]);

  // ── Error state ──
  if (loadError) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '24px',
          color: 'var(--text-3)',
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
        }}
      >
        {loadError}
      </div>
    );
  }

  return (
    <>
      <input
        ref={titleRef}
        id="code-title"
        type="text"
        placeholder="Untitled"
        className="code-title-input"
        spellCheck={false}
        aria-label="Note title"
        onChange={handleTitleChange}
      />
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </>
  );
}
