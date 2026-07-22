/**
 * HistoryDialog.tsx — Version history modal with diff viewer.
 *
 * Port of history.ts (DOM-based) to React + Radix Dialog.
 * Fetches version metadata, renders a scrollable version list,
 * and shows a line diff between selected versions.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { VersionMeta } from '../api.js';
import { fetchVersionList, fetchVersionContent } from '../api.js';
import { computeDiff, type DiffLine } from '../diff.js';
import { formatTimestamp, esc } from '../utils.js';

/* ── Props ──────────────────────────────────────────────────────────────── */

export interface HistoryDialogProps {
  noteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the raw content of the restored version. */
  onRestore: (content: string) => void;
}

/* ── Component ──────────────────────────────────────────────────────────── */

export default function HistoryDialog({ noteId, open, onOpenChange, onRestore }: HistoryDialogProps) {
  // ── Server data ──
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Selection ──
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [diffTargetKey, setDiffTargetKey] = useState<string | null>(null);

  // ── Diff ──
  const [diffLines, setDiffLines] = useState<DiffLine[] | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // ── Content cache (ref — not state) ──
  const contentCache = useRef<Map<string, string>>(new Map());

  // ── Fetch version list on open ──
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setVersions([]);
    setCurrentKey(null);
    setSelectedKey(null);
    setDiffTargetKey(null);
    setDiffLines(null);
    contentCache.current = new Map();

    fetchVersionList(noteId)
      .then(data => {
        if (cancelled) return;
        setVersions(data.versions);
        setCurrentKey(data.current);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError((err as Error).message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, noteId]);

  // ── Select a version ──
  const selectVersion = useCallback((vkey: string) => {
    if (vkey === selectedKey) return;
    setSelectedKey(vkey);
    // Default diff target to CURRENT (or null if selected IS current)
    const target = currentKey !== vkey ? currentKey : null;
    setDiffTargetKey(target);
  }, [selectedKey, currentKey]);

  // ── Compute diff when selection changes ──
  useEffect(() => {
    if (!selectedKey) {
      setDiffLines(null);
      return;
    }

    const target = diffTargetKey;
    if (!target) {
      setDiffLines(null);
      return;
    }

    let cancelled = false;
    setDiffLoading(true);

    async function loadDiff() {
      const cache = contentCache.current;
      const toFetch: string[] = [];
      if (!cache.has(selectedKey!)) toFetch.push(selectedKey!);
      if (!cache.has(target!)) toFetch.push(target!);

      try {
        if (toFetch.length > 0) {
          const contents = await fetchVersionContent(noteId, toFetch);
          for (const [k, v] of Object.entries(contents)) {
            if (v !== null) cache.set(k, v);
          }
        }

        if (cancelled) return;
        const oldContent = cache.get(target!) ?? '';
        const newContent = cache.get(selectedKey!) ?? '';
        const lines = computeDiff(oldContent, newContent);
        setDiffLines(lines);
      } catch (err) {
        if (!cancelled) {
          console.error('[HistoryDialog] diff failed:', err);
          setDiffLines(null);
        }
      } finally {
        if (!cancelled) setDiffLoading(false);
      }
    }

    loadDiff();
    return () => { cancelled = true; };
  }, [selectedKey, diffTargetKey, noteId]);

  // ── Diff target change ──
  const handleDiffTargetChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setDiffTargetKey(e.target.value || null);
  }, []);

  // ── Restore ──
  const handleRestore = useCallback(async () => {
    if (!selectedKey || selectedKey === currentKey) return;
    try {
      const cache = contentCache.current;
      if (!cache.has(selectedKey)) {
        const contents = await fetchVersionContent(noteId, [selectedKey]);
        const c = contents[selectedKey];
        if (c !== null) cache.set(selectedKey, c);
      }
      const content = cache.get(selectedKey) ?? '';
      onRestore(content);
    } catch (err) {
      console.error('[HistoryDialog] restore failed:', err);
    }
  }, [selectedKey, currentKey, noteId, onRestore]);

  // ── "view" button → open raw content in new tab ──
  const openRawInTab = useCallback(async (vkey: string) => {
    try {
      const cache = contentCache.current;
      if (!cache.has(vkey)) {
        const contents = await fetchVersionContent(noteId, [vkey]);
        const c = contents[vkey];
        if (c !== null) cache.set(vkey, c);
      }
      const content = cache.get(vkey) ?? '';
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (err) {
      window.open(`data:text/plain;charset=utf-8,${encodeURIComponent('Error loading version: ' + (err as Error).message)}`, '_blank');
    }
  }, [noteId]);

  // ── "↗" pop-out → render diff in new tab ──
  const openDiffInTab = useCallback(() => {
    if (!selectedKey || !diffTargetKey) return;
    const cache = contentCache.current;
    const oldContent = cache.get(diffTargetKey) ?? '';
    const newContent = cache.get(selectedKey) ?? '';
    const lines = computeDiff(oldContent, newContent);

    const targetLabel = versions.find(v => v.key === diffTargetKey);
    const selectedLabel = versions.find(v => v.key === selectedKey);

    const htmlLines = lines.map(line => {
      const cls = line.type === '+' ? 'add' : line.type === '-' ? 'remove' : 'context';
      const prefix = line.type === ' ' ? '  ' : line.type + ' ';
      return `<div class="line ${cls}">${esc(prefix + line.text)}</div>`;
    }).join('\n');

    const htmlPage = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Diff: ${esc(noteId)}</title>
<style>
  body { background:#0a0a0a; color:#f0ece4; font:13px 'DM Mono',monospace; padding:24px; }
  .header { color:#7a7269; margin-bottom:16px; }
  .line { padding:1px 0; white-space:pre-wrap; }
  .add { color:#90c890; }
  .remove { color:#e07070; }
  .context { color:#7a7269; }
</style></head><body>
<div class="header">Diff: <strong>${esc(selectedLabel ? formatTimestamp(selectedLabel.saved_at) + ' ' + selectedLabel.author : selectedKey)}</strong>
 vs <strong>${esc(targetLabel ? formatTimestamp(targetLabel.saved_at) + ' ' + targetLabel.author : diffTargetKey)}</strong>
 — ${esc(noteId)}</div>
${htmlLines}
</body></html>`;

    const blob = new Blob([htmlPage], { type: 'text/html;charset=utf-8' });
    window.open(URL.createObjectURL(blob), '_blank');
  }, [selectedKey, diffTargetKey, noteId, versions]);

  // ── Branch detection ──
  function isBranch(i: number): boolean {
    if (i < 1) return false;
    const curr = versions[i - 1];
    const prev = versions[i];
    const beforePrev = i >= 2 ? versions[i - 2] : undefined;
    return !!(curr.prev && curr.prev !== prev.key && curr.prev !== beforePrev?.key);
  }

  // ── Diff display ──
  const MAX_DIFF_LINES = 500;
  const displayLines = diffLines
    ? diffLines.length > MAX_DIFF_LINES
      ? diffLines.slice(0, MAX_DIFF_LINES)
      : diffLines
    : null;
  const truncated = diffLines && diffLines.length > MAX_DIFF_LINES
    ? diffLines.length - MAX_DIFF_LINES
    : 0;

  // ── Render ──

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="history-overlay" />
        <Dialog.Content className="history-card" aria-describedby={undefined}>
          {/* ── Header ── */}
          <Dialog.Title className="history-header">
            <span>Version History — <strong>{noteId}</strong></span>
            <Dialog.Close className="history-close">×</Dialog.Close>
          </Dialog.Title>

          {/* ── Body ── */}
          <div className="history-body">
            {loading ? (
              <div className="history-loading" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                <div className="sidebar-spinner" aria-hidden="true" />
                <span>Loading version history…</span>
              </div>
            ) : error ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <div className="history-diff-error">Failed to load version history: {esc(error)}</div>
                <button
                  className="btn btn-small"
                  onClick={() => {
                    setLoading(true);
                    setError(null);
                    fetchVersionList(noteId)
                      .then(data => { setVersions(data.versions); setCurrentKey(data.current); setLoading(false); })
                      .catch(err => { setError((err as Error).message); setLoading(false); });
                  }}
                >
                  Retry
                </button>
              </div>
            ) : versions.length === 0 ? (
              <div className="history-diff-empty" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                No version history available
              </div>
            ) : (
              <>
                {/* ── Version list ── */}
                <div className="history-version-list">
                  {versions.map((v, i) => {
                    const isCurrent = v.key === currentKey;
                    const isSelected = v.key === selectedKey;
                    return (
                      <div key={v.key}>
                        <div
                          className={`history-version-row${isSelected ? ' selected' : ''}`}
                          data-key={v.key}
                          onClick={() => selectVersion(v.key)}
                        >
                          <span className="history-version-marker">{isSelected ? '●' : '○'}</span>
                          <span className="history-version-date">{formatTimestamp(v.saved_at)}</span>
                          <span className="history-version-author">{v.author}</span>
                          {isCurrent && <span className="history-version-current-label">CURRENT</span>}
                          <button
                            className="btn-small history-view-btn"
                            title="View raw content"
                            onClick={e => { e.stopPropagation(); openRawInTab(v.key); }}
                          >
                            view
                          </button>
                        </div>
                        {isBranch(i) && (
                          <div className="history-branch-connector">├─ prev ──────────────────────────────</div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* ── Diff section ── */}
                {selectedKey && diffTargetKey && (
                  <div className="history-diff-section">
                    <div className="history-diff-header">
                      <span className="history-diff-label">diff: ●  vs  </span>
                      <select
                        className="history-diff-select"
                        value={diffTargetKey}
                        onChange={handleDiffTargetChange}
                      >
                        {versions.map(v =>
                          v.key === selectedKey ? (
                            <option key={v.key} value={v.key} disabled>
                              {formatTimestamp(v.saved_at)} {v.author} (selected)
                            </option>
                          ) : (
                            <option key={v.key} value={v.key}>
                              {formatTimestamp(v.saved_at)} {v.author}
                            </option>
                          ),
                        )}
                      </select>
                      <button
                        className="btn-small history-popout-btn"
                        title="Open diff in new tab"
                        onClick={openDiffInTab}
                      >
                        ↗
                      </button>
                    </div>

                    <div className="history-diff-preview">
                      {diffLoading ? (
                        <div className="history-diff-loading">Loading diff…</div>
                      ) : displayLines && displayLines.length > 0 ? (
                        <>
                          {displayLines.map((line, i) => (
                            <div
                              key={i}
                              className={`history-diff-line history-diff-${line.type === '+' ? 'add' : line.type === '-' ? 'remove' : 'context'}`}
                            >
                              {line.type === ' ' ? '  ' : line.type + ' '}{line.text}
                            </div>
                          ))}
                          {truncated > 0 && (
                            <div className="history-diff-truncated">
                              … {truncated} more lines (diff truncated)
                            </div>
                          )}
                        </>
                      ) : displayLines && displayLines.length === 0 ? (
                        <div className="history-diff-empty">No differences</div>
                      ) : (
                        <div className="history-diff-loading">Loading diff…</div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Footer ── */}
          <div className="history-footer">
            <Dialog.Close className="btn">Close</Dialog.Close>
            <button
              className="btn btn-primary"
              disabled={!selectedKey || selectedKey === currentKey}
              onClick={handleRestore}
            >
              {selectedKey === currentKey ? 'This is the current version' : 'Restore this version'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
