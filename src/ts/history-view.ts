/**
 * history-view.ts — version history modal UI
 *
 * Extracted from history.ts. Fetches version data and renders the DOM
 * modal with diff preview between selected versions.
 *
 * Lazy-loaded via dynamic import() when the user clicks "View History".
 */

import type { DiffLine } from './diff.js';
import { computeDiff } from './diff.js';
import type { VersionMeta, VersionListResponse } from './history-service.js';
import { fetchVersionList, fetchVersionContent } from './history-service.js';
import { formatTimestamp, esc } from './utils.js';

// ── Public types ────────────────────────────────────────────────────────────

export interface HistoryCallbacks {
  onRestore: (content: string) => void;
}

// ── DOM builder ─────────────────────────────────────────────────────────────

interface HistoryModal {
  el: HTMLElement;
  close: () => void;
}

function buildModal(
  noteId: string,
  metaList: VersionMeta[],
  currentKey: string | null,
  callbacks: HistoryCallbacks,
): HistoryModal {
  // Content cache scoped to this modal session
  const contentCache = new Map<string, string>();

  let selectedKey: string | null = null;      // selected version (●)
  let diffTargetKey: string | null = currentKey;  // comparison target (default: CURRENT)

  // ── Create overlay ────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'history-overlay';

  const card = document.createElement('div');
  card.className = 'history-card';
  overlay.appendChild(card);

  // ── Header ───────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'history-header';
  header.innerHTML = `<span>Version History — <strong>${esc(noteId)}</strong></span>`;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'history-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close (Esc)';
  header.appendChild(closeBtn);
  card.appendChild(header);

  // ── Body ─────────────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'history-body';
  card.appendChild(body);

  // ── Version list ─────────────────────────────────────────────────────
  const listEl = document.createElement('div');
  listEl.className = 'history-version-list';

  for (const v of metaList) {
    const row = document.createElement('div');
    row.className = 'history-version-row';
    row.dataset.key = v.key;

    const isCurrent = v.key === currentKey;

    row.innerHTML = [
      `<span class="history-version-marker">○</span>`,
      `<span class="history-version-date">${formatTimestamp(v.saved_at)}</span>`,
      `<span class="history-version-author">${esc(v.author)}</span>`,
      isCurrent ? '<span class="history-version-current-label">CURRENT</span>' : '',
      '<button class="btn-small history-view-btn" title="View raw content">view</button>',
    ].join('');

    // Click to select this version
    row.addEventListener('click', (e) => {
      // Don't select if clicking view button (handled separately)
      const target = e.target as HTMLElement;
      if (target.closest('.history-view-btn')) return;
      selectVersion(v.key);
    });

    // "view" button → open raw content in new tab
    const viewBtn = row.querySelector('.history-view-btn') as HTMLButtonElement;
    viewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openRawInTab(noteId, v.key);
    });

    listEl.appendChild(row);
  }

  body.appendChild(listEl);

  // ── Branch connectors ────────────────────────────────────────────────
  // Rendered between consecutive versions where prev doesn't point to
  // the chronologically previous entry — indicates a visible branch.
  renderBranchConnectors(listEl, metaList);

  // ── Diff section ─────────────────────────────────────────────────────
  const diffSection = document.createElement('div');
  diffSection.className = 'history-diff-section';
  diffSection.style.display = 'none'; // hidden until a version is selected

  const diffHeader = document.createElement('div');
  diffHeader.className = 'history-diff-header';
  diffSection.appendChild(diffHeader);

  const diffPreview = document.createElement('div');
  diffPreview.className = 'history-diff-preview';
  diffSection.appendChild(diffPreview);

  body.appendChild(diffSection);

  // ── Footer ───────────────────────────────────────────────────────────
  const footer = document.createElement('div');
  footer.className = 'history-footer';

  const closeFooterBtn = document.createElement('button');
  closeFooterBtn.className = 'btn';
  closeFooterBtn.textContent = 'Close';
  footer.appendChild(closeFooterBtn);

  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'btn btn-primary';
  restoreBtn.textContent = 'Restore this version';
  restoreBtn.disabled = true;
  footer.appendChild(restoreBtn);

  card.appendChild(footer);

  // ── State management ─────────────────────────────────────────────────

  function selectVersion(vkey: string): void {
    if (selectedKey === vkey) return;
    selectedKey = vkey;

    // Update row markers
    listEl.querySelectorAll('.history-version-row').forEach(r => {
      const el = r as HTMLElement;
      const isSel = el.dataset.key === vkey;
      el.classList.toggle('selected', isSel);
      const marker = el.querySelector('.history-version-marker');
      if (marker) marker.textContent = isSel ? '●' : '○';
    });

    // Update restore button
    const isCurrent = vkey === currentKey;
    restoreBtn.disabled = isCurrent;
    if (isCurrent) {
      restoreBtn.textContent = 'This is the current version';
    } else {
      restoreBtn.textContent = 'Restore this version';
    }

    // If diff target is not set, default to CURRENT
    if (!diffTargetKey) diffTargetKey = currentKey;

    // If diff target is the same as selected, pick the other
    if (diffTargetKey === vkey) {
      diffTargetKey = currentKey !== vkey ? currentKey : null;
    }

    // Show diff section
    diffSection.style.display = 'block';
    renderDiffHeader();
    renderDiff();
  }

  function renderDiffHeader(): void {
    diffHeader.innerHTML = '';

    const label = document.createElement('span');
    label.textContent = 'diff: ●  vs  ';
    label.className = 'history-diff-label';
    diffHeader.appendChild(label);

    // Dropdown for comparison target
    const sel = document.createElement('select');
    sel.className = 'history-diff-select';
    for (const v of metaList) {
      const opt = document.createElement('option');
      opt.value = v.key;
      if (v.key === selectedKey) {
        opt.disabled = true;
        opt.textContent = `${formatTimestamp(v.saved_at)} ${v.author} (selected)`;
      } else {
        opt.textContent = `${formatTimestamp(v.saved_at)} ${v.author}`;
      }
      if (v.key === diffTargetKey) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      diffTargetKey = sel.value || null;
      renderDiff();
    });
    diffHeader.appendChild(sel);

    // Pop-out button
    const popoutBtn = document.createElement('button');
    popoutBtn.className = 'btn-small history-popout-btn';
    popoutBtn.textContent = '↗';
    popoutBtn.title = 'Open diff in new tab';
    popoutBtn.addEventListener('click', () => openDiffInTab());
    diffHeader.appendChild(popoutBtn);
  }

  async function renderDiff(): Promise<void> {
    if (!selectedKey || !diffTargetKey) {
      diffPreview.innerHTML = '<div class="history-diff-empty">Select two versions to compare</div>';
      return;
    }

    diffPreview.innerHTML = '<div class="history-diff-loading">Loading diff…</div>';

    try {
      // Fetch both versions' content (only uncached ones)
      const toFetch: string[] = [];
      if (!contentCache.has(selectedKey)) toFetch.push(selectedKey);
      if (!contentCache.has(diffTargetKey)) toFetch.push(diffTargetKey);

      if (toFetch.length > 0) {
        const contents = await fetchVersionContent(noteId, toFetch);
        for (const [k, v] of Object.entries(contents)) {
          if (v !== null) contentCache.set(k, v);
        }
      }

      const oldContent = contentCache.get(diffTargetKey) ?? '';
      const newContent = contentCache.get(selectedKey) ?? '';
      const lines = computeDiff(oldContent, newContent);

      diffPreview.innerHTML = '';

      // Limit display for very large diffs
      const maxDisplay = 500;
      const displayLines = lines.length > maxDisplay
        ? lines.slice(0, maxDisplay)
        : lines;

      if (displayLines.length === 0) {
        diffPreview.innerHTML = '<div class="history-diff-empty">No differences</div>';
        return;
      }

      for (const line of displayLines) {
        const div = document.createElement('div');
        div.className = `history-diff-line history-diff-${line.type === '+' ? 'add' : line.type === '-' ? 'remove' : 'context'}`;
        div.textContent = (line.type === ' ' ? '  ' : line.type + ' ') + line.text;
        diffPreview.appendChild(div);
      }

      if (lines.length > maxDisplay) {
        const truncated = document.createElement('div');
        truncated.className = 'history-diff-truncated';
        truncated.textContent = `… ${lines.length - maxDisplay} more lines (diff truncated)`;
        diffPreview.appendChild(truncated);
      }
    } catch (err) {
      diffPreview.innerHTML = `<div class="history-diff-error">Failed to load diff: ${esc((err as Error).message)}</div>`;
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────

  async function openRawInTab(noteId: string, vkey: string): Promise<void> {
    try {
      if (!contentCache.has(vkey)) {
        const contents = await fetchVersionContent(noteId, [vkey]);
        const c = contents[vkey];
        if (c !== null && c !== undefined) contentCache.set(vkey, c);
      }
      const content = contentCache.get(vkey) ?? '';
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      // fallback: try fetching in new tab
      window.open(`data:text/plain;charset=utf-8,${encodeURIComponent('Error loading version: ' + (err as Error).message)}`, '_blank');
    }
  }

  function openDiffInTab(): void {
    if (!selectedKey || !diffTargetKey) return;
    const oldContent = contentCache.get(diffTargetKey) ?? '';
    const newContent = contentCache.get(selectedKey) ?? '';
    const lines = computeDiff(oldContent, newContent);

    const htmlLines = lines.map(line => {
      const cls = line.type === '+' ? 'add' : line.type === '-' ? 'remove' : 'context';
      const prefix = line.type === ' ' ? '  ' : line.type + ' ';
      return `<div class="line ${cls}">${esc(prefix + line.text)}</div>`;
    }).join('\n');

    const targetLabel = metaList.find(v => v.key === diffTargetKey);
    const selectedLabel = metaList.find(v => v.key === selectedKey);

    const html = `<!DOCTYPE html>
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

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    window.open(URL.createObjectURL(blob), '_blank');
  }

  async function handleRestore(): Promise<void> {
    if (!selectedKey || selectedKey === currentKey) return;
    try {
      if (!contentCache.has(selectedKey)) {
        const contents = await fetchVersionContent(noteId, [selectedKey]);
        const c = contents[selectedKey];
        if (c !== null && c !== undefined) contentCache.set(selectedKey, c);
      }
      const content = contentCache.get(selectedKey) ?? '';
      callbacks.onRestore(content);
      close();
    } catch (err) {
      console.error('[history] Restore failed:', err);
    }
  }

  // ── Event wiring ─────────────────────────────────────────────────────

  closeBtn.addEventListener('click', close);
  closeFooterBtn.addEventListener('click', close);
  restoreBtn.addEventListener('click', handleRestore);

  // Close on Escape
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);

  // Close on click-outside
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // ── Close ────────────────────────────────────────────────────────────

  function close(): void {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    contentCache.clear();
  }

  // ── Render branch connectors ─────────────────────────────────────────
  function renderBranchConnectors(listEl: HTMLElement, metaList: VersionMeta[]): void {
    const rows = listEl.querySelectorAll('.history-version-row');
    for (let i = 1; i < rows.length; i++) {
      const curr = metaList[i - 1];
      const prev = metaList[i];
      if (curr.prev && curr.prev !== prev.key && curr.prev !== (i >= 2 ? metaList[i - 2]?.key : undefined)) {
        // Branch detected: curr.prev doesn't point to the chronologically next version
        const connector = document.createElement('div');
        connector.className = 'history-branch-connector';
        connector.textContent = '├─ prev ──────────────────────────────';
        rows[i - 1].after(connector);
      }
    }
  }

  // Append to document
  document.body.appendChild(overlay);

  return { el: overlay, close };
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Open the version history modal for a note.
 * Called via dynamic import(): `const { open } = await import('./history-view.js');`
 *
 * @param noteId    The note identifier
 * @param callbacks Callbacks for restore action
 */
export async function open(noteId: string, callbacks: HistoryCallbacks): Promise<void> {
  // Show loading overlay while fetching
  const loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'history-overlay';
  loadingOverlay.innerHTML = '<div class="history-card history-loading"><div class="sidebar-spinner"></div><span>Loading version history…</span></div>';
  document.body.appendChild(loadingOverlay);

  try {
    const data = await fetchVersionList(noteId);
    loadingOverlay.remove();

    if (data.versions.length === 0) {
      // Empty state — show simple notice
      const emptyOverlay = document.createElement('div');
      emptyOverlay.className = 'history-overlay';
      emptyOverlay.innerHTML = `<div class="history-card">
        <div class="history-header"><span>Version History — <strong>${esc(noteId)}</strong></span>
        <button class="history-close" title="Close (Esc)">×</button></div>
        <div class="history-body"><div class="history-diff-empty">No version history available</div></div>
        <div class="history-footer"><button class="btn">Close</button></div>
      </div>`;

      const closeBtn = emptyOverlay.querySelector('.history-close')!;
      const footerBtn = emptyOverlay.querySelector('.btn')!;
      function closeEmpty() { emptyOverlay.remove(); }
      closeBtn.addEventListener('click', closeEmpty);
      footerBtn.addEventListener('click', closeEmpty);
      emptyOverlay.addEventListener('click', (e) => { if (e.target === emptyOverlay) closeEmpty(); });
      document.addEventListener('keydown', function onEsc(e) {
        if (e.key === 'Escape') { closeEmpty(); document.removeEventListener('keydown', onEsc); }
      });

      document.body.appendChild(emptyOverlay);
      return;
    }

    buildModal(noteId, data.versions, data.current, callbacks);
  } catch (err) {
    loadingOverlay.remove();
    // Show error
    const errOverlay = document.createElement('div');
    errOverlay.className = 'history-overlay';
    errOverlay.innerHTML = `<div class="history-card">
      <div class="history-header"><span>Version History — <strong>${esc(noteId)}</strong></span>
      <button class="history-close" title="Close (Esc)">×</button></div>
      <div class="history-body">
        <div class="history-diff-error">Failed to load version history: ${esc((err as Error).message)}</div>
        <button class="btn btn-small history-retry-btn" style="margin-top:12px">Retry</button>
      </div>
      <div class="history-footer"><button class="btn">Close</button></div>
    </div>`;

    function closeErr() { errOverlay.remove(); }
    const closeBtn = errOverlay.querySelector('.history-close')!;
    const footerBtn = errOverlay.querySelector('.btn')!;
    const retryBtn = errOverlay.querySelector('.history-retry-btn')!;
    closeBtn.addEventListener('click', closeErr);
    footerBtn.addEventListener('click', closeErr);
    retryBtn.addEventListener('click', () => { closeErr(); open(noteId, callbacks); });
    errOverlay.addEventListener('click', (e) => { if (e.target === errOverlay) closeErr(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { closeErr(); document.removeEventListener('keydown', onEsc); }
    });

    document.body.appendChild(errOverlay);
  }
}
