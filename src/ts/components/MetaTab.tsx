/**
 * MetaTab.tsx — Structured metadata editor tab.
 *
 * Phase 4c: port of meta-view.ts to React.
 *           Parses frontmatter, renders form fields (title, summary, tags,
 *           custom fields, language), and flushes changes immediately to
 *           the note content via setContent.  Shows read-only system info.
 *           All inputs are disabled for system notes.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppState } from '../state/AppContext.js';
import { useNotes } from '../hooks/useNotes.js';
import HistoryDialog from './HistoryDialog.js';
import {
  parseFrontmatter,
  initPendingMeta,
  pendingMetaToUpdates,
  updateFrontmatter,
  RESERVED_KEYS,
  type PendingMeta,
} from '../frontmatter.js';
import { computeStats, formatTimestamp } from '../utils.js';
import { formatDuration } from '../render-fm.js';
import { getLanguageConfig } from '../config.js';

/* ── Known-key value hints (mirrors meta-view.ts) ─────────────────────── */

const KNOWN_KEYS: Record<string, string> = {
  category:      'e.g. report, invoice, quote',
  comments:      'e.g. review notes, follow-up needed',
  company:       'e.g. Acme Corp, Widgets Inc',
  manager:       'e.g. John Smith',
  status:        'e.g. draft, final, withdrawn',
  template:      'true or false',
  'template-deps': 'comma-separated note IDs',
};

/* ── Language display helper ──────────────────────────────────────────── */

function langDisplayName(tag: string): string {
  try {
    const dn = new Intl.DisplayNames([tag], { type: 'language' });
    return dn.of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/* ── Component ────────────────────────────────────────────────────────── */

export default function MetaTab() {
  const { activeNoteId, activeNoteContent, activeNoteData, isSystemNote } = useAppState();
  const { setContent } = useNotes();

  const readOnly = isSystemNote;
  const langConfig = useMemo(() => getLanguageConfig(), []);

  /* ── Stable refs (stale-closure avoidance) ── */
  const isInternal = useRef(false);
  const contentRef = useRef(activeNoteContent);
  contentRef.current = activeNoteContent;
  const setContentRef = useRef(setContent);
  setContentRef.current = setContent;

  /* ── Form state ── */
  const [pendingMeta, setPendingMeta] = useState<PendingMeta>({
    title: '', summary: '', tags: [], custom: {}, lang: undefined,
  });

  /** Raw tags input text (preserves separators the user is typing). */
  const [tagsRaw, setTagsRaw] = useState('');

  /** Whether the language row is visible (separate from lang value). */
  const [showLangRow, setShowLangRow] = useState(false);

  /** Whether the history dialog is open. */
  const [showHistory, setShowHistory] = useState(false);

  /**
   * Extra custom-field rows that haven't been committed yet
   * (user clicked "+ Add" but hasn't typed a key).  Purely visual —
   * not included in pendingMeta.custom until a non-empty key is entered.
   */
  const [extraRows, setExtraRows] = useState<Array<{ key: string; value: string }>>([]);

  /* ── Flush helper ── */

  /**
   * Merge pendingMeta into the current note content via updateFrontmatter.
   * Uses refs to avoid stale closures — safe to call from any handler.
   */
  const flush = useCallback((pm: PendingMeta) => {
    const raw = contentRef.current || '';
    const updates = pendingMetaToUpdates(pm);

    // Detect deleted custom keys: any key in the current frontmatter that
    // is NOT reserved and NOT present in pm.custom must be marked for deletion.
    // Without this, updateFrontmatter (a merge) preserves keys absent from updates.
    const fm = parseFrontmatter(raw);
    for (const key of Object.keys(fm.meta)) {
      if (RESERVED_KEYS.has(key)) continue;
      if (key in updates) continue;
      if (!(key in pm.custom)) {
        updates[key] = undefined; // → delete from frontmatter
      }
    }

    const merged = updateFrontmatter(raw, updates);
    if (merged !== raw) {
      isInternal.current = true;
      setContentRef.current(merged);
    }
  }, []);

  /* ── Sync external content changes → form ── */

  useEffect(() => {
    if (isInternal.current) {
      isInternal.current = false;
      return;
    }
    if (activeNoteContent === null) return;
    const fm = parseFrontmatter(activeNoteContent);
    const pm = initPendingMeta(fm.meta);
    setPendingMeta(pm);
    setTagsRaw(pm.tags.join(', '));
    setShowLangRow(typeof pm.lang === 'string');
    setExtraRows([]);
  }, [activeNoteContent]);

  /* ── Stats (body only, frontmatter stripped) ── */

  const stats = useMemo(() => {
    if (activeNoteContent === null) return null;
    const fm = parseFrontmatter(activeNoteContent);
    return computeStats(fm.body);
  }, [activeNoteContent]);

  /* ── Language datalist options ── */

  const langOptions = useMemo(
    () => langConfig.preferred_langs.map(l => ({
      value: l,
      label: `${l} — ${langDisplayName(l)}`,
    })),
    [langConfig.preferred_langs],
  );

  /* ── Handlers ──────────────────────────────────────────────────────── */

  /** Apply a partial update to pendingMeta and flush to content. */
  const updateMeta = useCallback((patch: Partial<PendingMeta>) => {
    if (readOnly) return;
    setPendingMeta(prev => {
      const next = { ...prev, ...patch };
      flush(next);
      return next;
    });
  }, [readOnly, flush]);

  const onTitleChange   = useCallback((e: React.ChangeEvent<HTMLInputElement>)  => updateMeta({ title: e.target.value }), [updateMeta]);
  const onSummaryChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => updateMeta({ summary: e.target.value }), [updateMeta]);
  const onTagsChange    = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setTagsRaw(raw);
    const tags = raw.split(',').map(s => s.trim()).filter(Boolean);
    updateMeta({ tags });
  }, [updateMeta]);

  /* ── Custom-field handlers ── */

  const onAddCustom = useCallback(() => {
    if (readOnly) return;
    setExtraRows(prev => [...prev, { key: '', value: '' }]);
  }, [readOnly]);

  /** Promote an extra row to a real custom entry (key just became non-empty). */
  const promoteExtraRow = useCallback((rowIndex: number, newKey: string, newValue: string) => {
    setPendingMeta(prev => {
      const next = {
        ...prev,
        custom: { ...prev.custom, [newKey.trim()]: newValue },
      };
      flush(next);
      return next;
    });
    setExtraRows(prev => prev.filter((_, i) => i !== rowIndex));
  }, [flush]);

  const onCustomKeyChange = useCallback((entryIndex: number, totalReal: number, newKey: string) => {
    if (readOnly) return;
    if (entryIndex < totalReal) {
      // Real entry — update key in pendingMeta.custom
      const realKeys = Object.keys(pendingMeta.custom);
      const oldKey = realKeys[entryIndex];
      if (newKey.trim()) {
        // Rename key — reconstruct object to preserve insertion order.
        // delete+add shifts the new key to the end, which breaks index-based
        // React keys when Object.keys() iterates in a different order.
        setPendingMeta(prev => {
          const nextCustom: Record<string, string> = {};
          for (const [k, v] of Object.entries(prev.custom)) {
            if (k === oldKey) {
              nextCustom[newKey.trim()] = v;
            } else {
              nextCustom[k] = v;
            }
          }
          const next = { ...prev, custom: nextCustom };
          flush(next);
          return next;
        });
      } else {
        // Key cleared — demote to an extra row (preserve value)
        setPendingMeta(prev => {
          const nextCustom = { ...prev.custom };
          const val = nextCustom[oldKey] ?? '';
          delete nextCustom[oldKey];
          const next = { ...prev, custom: nextCustom };
          flush(next);
          return next;
        });
        setExtraRows(prev => [{ key: '', value: pendingMeta.custom[oldKey] ?? '' }, ...prev]);
      }
    } else {
      // Extra row — update key, promote if non-empty
      const extraIdx = entryIndex - totalReal;
      if (newKey.trim()) {
        promoteExtraRow(extraIdx, newKey, extraRows[extraIdx]?.value ?? '');
      } else {
        setExtraRows(prev => prev.map((row, i) =>
          i === extraIdx ? { ...row, key: newKey } : row,
        ));
      }
    }
  }, [readOnly, pendingMeta.custom, extraRows, flush, promoteExtraRow]);

  const onCustomValueChange = useCallback((entryIndex: number, totalReal: number, newValue: string) => {
    if (readOnly) return;
    if (entryIndex < totalReal) {
      const realKeys = Object.keys(pendingMeta.custom);
      const key = realKeys[entryIndex];
      setPendingMeta(prev => {
        const next = { ...prev, custom: { ...prev.custom, [key]: newValue } };
        flush(next);
        return next;
      });
    } else {
      const extraIdx = entryIndex - totalReal;
      setExtraRows(prev => prev.map((row, i) =>
        i === extraIdx ? { ...row, value: newValue } : row,
      ));
      // Don't flush — key is still empty, row isn't committed yet
    }
  }, [readOnly, pendingMeta.custom, flush]);

  const onRemoveCustom = useCallback((entryIndex: number, totalReal: number) => {
    if (readOnly) return;
    if (entryIndex < totalReal) {
      const realKeys = Object.keys(pendingMeta.custom);
      const key = realKeys[entryIndex];
      setPendingMeta(prev => {
        const nextCustom = { ...prev.custom };
        delete nextCustom[key];
        const next = { ...prev, custom: nextCustom };
        flush(next);
        return next;
      });
    } else {
      const extraIdx = entryIndex - totalReal;
      setExtraRows(prev => prev.filter((_, i) => i !== extraIdx));
    }
  }, [readOnly, pendingMeta.custom, flush]);

  /* ── Language handlers ── */

  const onAddLang = useCallback(() => {
    if (readOnly) return;
    setShowLangRow(true);
    // Start with empty value — the placeholder shows default_lang as hint.
    setPendingMeta(prev => {
      const next = { ...prev, lang: '' };
      flush(next);
      return next;
    });
  }, [readOnly, flush]);

  const onLangChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateMeta({ lang: e.target.value });
  }, [updateMeta]);

  const onRemoveLang = useCallback(() => {
    setShowLangRow(false);
    setPendingMeta(prev => {
      const { lang: _, ...rest } = prev;
      const next = { ...rest, lang: undefined };
      flush(next);
      return next;
    });
  }, [flush]);

  /* ── Derived values for rendering ── */

  const realCustomKeys = Object.keys(pendingMeta.custom);
  const totalReal = realCustomKeys.length;

  // All visible custom rows: real entries first, then extra rows
  const visibleRows: Array<{ key: string; value: string; isReal: boolean }> = [
    ...realCustomKeys.map(k => ({ key: k, value: pendingMeta.custom[k] ?? '', isReal: true })),
    ...extraRows.map(r => ({ key: r.key, value: r.value, isReal: false })),
  ];

  /* ── Render ────────────────────────────────────────────────────────── */

  return (
    <div id="meta-panel">
      {/* ── Title ── */}
      <div className="meta-field">
        <label htmlFor="meta-title">Title</label>
        <input
          id="meta-title"
          type="text"
          className="meta-input"
          placeholder="Note title"
          spellCheck={false}
          value={pendingMeta.title}
          onChange={onTitleChange}
          readOnly={readOnly}
        />
      </div>

      {/* ── Summary ── */}
      <div className="meta-field">
        <label htmlFor="meta-summary">Summary</label>
        <textarea
          id="meta-summary"
          className="meta-textarea"
          placeholder="Short description"
          rows={3}
          value={pendingMeta.summary}
          onChange={onSummaryChange}
          readOnly={readOnly}
        />
      </div>

      {/* ── Tags ── */}
      <div className="meta-field">
        <label htmlFor="meta-tags">Tags</label>
        <input
          id="meta-tags"
          type="text"
          className="meta-input"
          placeholder="tag1, tag2, tag3"
          spellCheck={false}
          value={tagsRaw}
          onChange={onTagsChange}
          readOnly={readOnly}
        />
      </div>

      {/* ── Custom Fields ── */}
      <div id="meta-custom-section">
        <div className="meta-section-header">
          <span>Custom Fields</span>
          {!readOnly && (
            <>
              <button id="btn-add-custom" className="btn-small" onClick={onAddCustom}>+ Add</button>
              {!showLangRow && (
                <button id="btn-add-lang" className="btn-small" onClick={onAddLang}>+ Language</button>
              )}
            </>
          )}
        </div>

        <div id="meta-custom-rows">
          {visibleRows.map((row, i) => {
            const isReserved = RESERVED_KEYS.has(row.key.trim());
            const placeholder = isReserved
              ? `⚠ reserved — use the "${row.key.trim()}" field above`
              : KNOWN_KEYS[row.key.toLowerCase()] || 'value';
            return (
              <div className="custom-row" key={i}>
                <input
                  type="text"
                  className={`meta-input custom-key${isReserved ? ' invalid' : ''}`}
                  placeholder="key"
                  spellCheck={false}
                  autoComplete="off"
                  list="known-keys"
                  value={row.key}
                  readOnly={readOnly}
                  onChange={e => onCustomKeyChange(i, totalReal, e.target.value)}
                />
                <input
                  type="text"
                  className="meta-input custom-val"
                  placeholder={placeholder}
                  spellCheck={false}
                  autoComplete="off"
                  value={row.value}
                  readOnly={readOnly}
                  onChange={e => onCustomValueChange(i, totalReal, e.target.value)}
                />
                {!readOnly && (
                  <button
                    type="button"
                    className="btn-remove-custom"
                    title="Remove custom field"
                    onClick={() => onRemoveCustom(i, totalReal)}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}

          {/* ── Language row (committed) ── */}
          {showLangRow && (
            <div className="custom-row custom-row-lang">
              <input
                type="text"
                className="meta-input custom-key"
                value="lang"
                readOnly
                tabIndex={-1}
                spellCheck={false}
                autoComplete="off"
              />
              <input
                type="text"
                className="meta-input custom-val"
                placeholder={langConfig.default_lang}
                spellCheck={false}
                autoComplete="off"
                list="lang-list"
                value={pendingMeta.lang ?? ''}
                readOnly={readOnly}
                onChange={onLangChange}
              />
              {!readOnly && (
                <button
                  type="button"
                  className="btn-remove-custom"
                  title="Remove language"
                  onClick={onRemoveLang}
                >
                  ×
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Datalists (outside the scrolling container, per HTML spec) ── */}
      <datalist id="lang-list">
        {langOptions.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </datalist>
      <datalist id="known-keys">
        <option value="category">category</option>
        <option value="comments">comments</option>
        <option value="company">company</option>
        <option value="manager">manager</option>
        <option value="status">status</option>
        <option value="template">template</option>
        <option value="template-deps">template-deps</option>
      </datalist>

      {/* ── Stats ── */}
      <div id="meta-stats-section">
        <div className="meta-section-header">Size (body only)</div>
        <div id="meta-stats" className="meta-stats">
          {stats
            ? `${stats.chars.toLocaleString()} chars · ${stats.words.toLocaleString()} words · ${stats.lines} lines`
            : ''}
        </div>
      </div>

      {/* ── System Info ── */}
      <div id="meta-system-section">
        <div className="meta-section-header">System Info</div>
        <table id="meta-system-table" className="meta-system-table">
          <tbody>
            <tr>
              <td>Version</td>
              <td id="meta-sys-current">{activeNoteData?.current ?? ''}</td>
            </tr>
            <tr>
              <td>Created</td>
              <td id="meta-sys-created">
                {activeNoteData?.created_at
                  ? `${formatTimestamp(activeNoteData.created_at)}${activeNoteData.created_by ? ` by ${activeNoteData.created_by}` : ''}`
                  : ''}
              </td>
            </tr>
            <tr>
              <td>Updated</td>
              <td id="meta-sys-updated">
                {activeNoteData?.updated_at
                  ? `${formatTimestamp(activeNoteData.updated_at)}${activeNoteData.updated_by ? ` by ${activeNoteData.updated_by}` : ''}`
                  : ''}
              </td>
            </tr>
            <tr>
              <td>Edit time</td>
              <td id="meta-sys-edit-time">
                {(() => {
                  const et = activeNoteData?.meta?.['edit-time'];
                  const sec = typeof et === 'string' ? parseInt(et, 10) : 0;
                  return sec > 0 ? formatDuration(sec) : '—';
                })()}
              </td>
            </tr>
            <tr>
              <td></td>
              <td>
                <button id="btn-view-history" className="btn-small" style={readOnly ? { display: 'none' } : undefined} onClick={() => setShowHistory(true)}>
                  View History…
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── History dialog ── */}
      {activeNoteId && (
        <HistoryDialog
          noteId={activeNoteId}
          open={showHistory}
          onOpenChange={setShowHistory}
          onRestore={(content) => {
            setContentRef.current(content);
            setShowHistory(false);
          }}
        />
      )}
    </div>
  );
}
