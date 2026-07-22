/**
 * TagView.tsx — Tags mode sidebar view.
 *
 * Groups notes by their merged tags (user-tags + auto-tags via mergeTags)
 * and renders expandable tag sections via Radix Accordion.  Untagged notes
 * appear at the bottom under "Untagged".  Respects the sidebar search box
 * for filtering.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import * as Accordion from '@radix-ui/react-accordion';
import { dbGetNote } from '../db.js';
import { parseFrontmatter } from '../frontmatter.js';
import { mergeTags } from '../autotag.js';
import { naturalCompare } from '../utils.js';
import type { NoteMeta } from '../notes.js';

// ── Types ─────────────────────────────────────────────────────────────────

export interface TagViewItem extends NoteMeta {
  tags: string[];
}

interface TagGroup {
  tag: string;
  notes: TagViewItem[];
}

// ── Props ─────────────────────────────────────────────────────────────────

export interface TagViewProps {
  notes: NoteMeta[];
  activeNoteId: string | null;
  searchQuery: string;
  onOpen: (id: string) => void;
}

// ── Note row (extracted for reuse) ────────────────────────────────────────

function NoteRow({
  note,
  isActive,
  otherTags,
  onOpen,
}: {
  note: TagViewItem;
  isActive: boolean;
  otherTags: string[];
  onOpen: (id: string) => void;
}) {
  return (
    <div
      className={`file-item${isActive ? ' active' : ''}`}
      role="listitem"
      onClick={e => { e.stopPropagation(); onOpen(note.id); }}
    >
      <svg
        className="file-item-icon"
        width="12" height="12" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M9 12h6m-6 4h6m2 4H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l5 5v11a2 2 0 0 1-2 2z"/>
      </svg>
      <span className="file-item-name" title={note.id}>{note.id}</span>
      {otherTags.length > 0 && (
        <span className="file-item-tags">{otherTags.join(', ')}</span>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export default function TagView({
  notes,
  activeNoteId,
  searchQuery,
  onOpen,
}: TagViewProps) {
  // ── Tag data ─────────────────────────────────────────────────────────
  const [tagItems, setTagItems] = useState<TagViewItem[] | null>(null);
  const [accordionValue, setAccordionValue] = useState<string[]>([]);
  const didAutoExpand = useRef(false);

  // Load merged tags for every note (once per notes-array change).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const items: TagViewItem[] = [];
      for (const meta of notes) {
        const record = await dbGetNote(meta.id);
        if (cancelled) return;
        if (!record || !record.content) {
          items.push({ ...meta, tags: [] });
          continue;
        }
        const fm = parseFrontmatter(record.content);
        const userTags: string[] = Array.isArray(fm.meta['user-tags'])
          ? fm.meta['user-tags']
          : [];
        const autoTags: string[] = Array.isArray(fm.meta['auto-tags'])
          ? fm.meta['auto-tags']
          : [];
        items.push({ ...meta, tags: mergeTags(userTags, autoTags) });
      }
      if (cancelled) return;
      setTagItems(items);
    }
    didAutoExpand.current = false;
    setTagItems(null); // show loading
    load();
    return () => { cancelled = true; };
  }, [notes]);

  // ── Build groups ─────────────────────────────────────────────────────
  const { groups, untagged } = useMemo(() => {
    if (!tagItems) return { groups: [], untagged: [] };
    return buildGroups(tagItems);
  }, [tagItems]);

  // ── Auto-expand first group on initial load ──────────────────────────
  useEffect(() => {
    if (tagItems && !didAutoExpand.current && groups.length > 0) {
      didAutoExpand.current = true;
      setAccordionValue([groups[0].tag]);
    }
  }, [tagItems, groups]);

  // ── Filter ───────────────────────────────────────────────────────────
  const q = searchQuery.toLowerCase().trim();
  const isSearching = q.length > 0;

  const filtered = useMemo(() => {
    if (!q) return { groups, untagged };
    const fg = groups
      .map(g => ({
        tag: g.tag,
        notes: g.notes.filter(
          n =>
            n.id.toLowerCase().includes(q) ||
            n.tags.some(t => t.toLowerCase().includes(q)),
        ),
      }))
      .filter(g => g.tag.toLowerCase().includes(q) || g.notes.length > 0);
    const fu = untagged.filter(n => n.id.toLowerCase().includes(q));
    return { groups: fg, untagged: fu };
  }, [groups, untagged, q]);

  const displayGroups = filtered.groups;
  const displayUntagged = filtered.untagged;
  const totalDisplay =
    displayGroups.reduce((s, g) => s + g.notes.length, 0) + displayUntagged.length;

  // ── Accordion value ──────────────────────────────────────────────────
  // During search: auto-expand ALL groups so matches are visible.
  // Otherwise: use the user-toggled state.
  const controlledValue = useMemo(() => {
    if (isSearching) {
      const all = displayGroups.map(g => g.tag);
      if (displayUntagged.length > 0) all.push('Untagged');
      return all;
    }
    return accordionValue;
  }, [isSearching, displayGroups, displayUntagged, accordionValue]);

  const handleValueChange = (val: string[]) => {
    // During search, ignore user clicks — accordion is locked open.
    if (!isSearching) {
      setAccordionValue(val);
    }
  };

  // ── Render states ────────────────────────────────────────────────────

  // Loading
  if (!tagItems) {
    return (
      <div id="file-list" role="list" aria-label="Tags">
        <div className="tag-loading" style={{
          padding: '20px 12px', textAlign: 'center', fontSize: '11px',
          color: 'var(--text-3)', fontFamily: 'var(--font-mono)',
        }}>
          Loading tags…
        </div>
      </div>
    );
  }

  // Empty
  if (totalDisplay === 0) {
    return (
      <div id="file-list" role="list" aria-label="Tags">
        <div style={{
          padding: '20px 12px', textAlign: 'center', fontSize: '11px',
          color: 'var(--text-3)', fontFamily: 'var(--font-mono)',
        }}>
          {q ? 'No matching tags or notes' : 'No tags'}
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div id="file-list" role="list" aria-label="Tags">
      <Accordion.Root
        type="multiple"
        className="tag-accordion"
        value={controlledValue}
        onValueChange={handleValueChange}
      >
        {displayGroups.map(g => (
          <Accordion.Item key={g.tag} value={g.tag} className="tag-group">
            <Accordion.Header asChild>
              <div>
                <Accordion.Trigger asChild>
                  <div className="tree-bar" role="button" tabIndex={0}>
                    <span className="tree-toggle">
                      {controlledValue.includes(g.tag) ? '▼' : '▶'}
                    </span>
                    <svg
                      className="file-item-icon"
                      width="12" height="12" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M9 12h6m-6 4h6m2 4H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l5 5v11a2 2 0 0 1-2 2z"/>
                    </svg>
                    <span className="file-item-name">{g.tag}</span>
                    <span className="tag-count">{g.notes.length}</span>
                  </div>
                </Accordion.Trigger>
              </div>
            </Accordion.Header>
            <Accordion.Content className="tag-accordion-content">
              <div className="tree-children">
                {g.notes.map(note => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    isActive={note.id === activeNoteId}
                    otherTags={note.tags.filter(t => t !== g.tag)}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            </Accordion.Content>
          </Accordion.Item>
        ))}

        {/* ── Untagged section ── */}
        {displayUntagged.length > 0 && (
          <Accordion.Item value="Untagged" className="tag-group">
            <Accordion.Header asChild>
              <div>
                <Accordion.Trigger asChild>
                  <div className="tree-bar" role="button" tabIndex={0}>
                    <span className="tree-toggle">
                      {controlledValue.includes('Untagged') ? '▼' : '▶'}
                    </span>
                    <svg
                      className="file-item-icon"
                      width="12" height="12" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M9 12h6m-6 4h6m2 4H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l5 5v11a2 2 0 0 1-2 2z"/>
                    </svg>
                    <span className="file-item-name">Untagged</span>
                    <span className="tag-count">{displayUntagged.length}</span>
                  </div>
                </Accordion.Trigger>
              </div>
            </Accordion.Header>
            <Accordion.Content className="tag-accordion-content">
              <div className="tree-children">
                {displayUntagged.map(note => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    isActive={note.id === activeNoteId}
                    otherTags={[]}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            </Accordion.Content>
          </Accordion.Item>
        )}
      </Accordion.Root>
    </div>
  );
}

// ── Group builder ────────────────────────────────────────────────────────────

function buildGroups(items: TagViewItem[]): {
  groups: TagGroup[];
  untagged: TagViewItem[];
} {
  const tagMap = new Map<string, TagViewItem[]>();
  const untagged: TagViewItem[] = [];

  for (const item of items) {
    if (item.tags.length === 0) {
      untagged.push(item);
      continue;
    }
    for (const tag of item.tags) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag)!.push(item);
    }
  }

  const groups: TagGroup[] = [...tagMap.entries()]
    .sort(([a], [b]) => naturalCompare(a, b))
    .map(([tag, notes]) => ({
      tag,
      notes: notes.sort((a, b) => naturalCompare(a.id, b.id)),
    }));

  return {
    groups,
    untagged: untagged.sort((a, b) => naturalCompare(a.id, b.id)),
  };
}
