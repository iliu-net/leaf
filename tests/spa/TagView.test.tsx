/**
 * D2b — TagView component tests (part 1: loading, empty, search)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { NoteMeta } from '../../src/ts/notes.js';

const { mockDbGetNote, mockParseFrontmatter, mockMergeTags, mockNaturalCompare } =
  vi.hoisted(() => ({
    mockDbGetNote: vi.fn(),
    mockParseFrontmatter: vi.fn(),
    mockMergeTags: vi.fn(),
    mockNaturalCompare: vi.fn(),
  }));

vi.mock('../../src/ts/db.js', () => ({ dbGetNote: mockDbGetNote, ensureDbOpen: vi.fn(), db: { delete: vi.fn() } }));
vi.mock('../../src/ts/frontmatter.js', () => ({ parseFrontmatter: mockParseFrontmatter, updateFrontmatter: vi.fn(), stripFrontmatterKey: vi.fn() }));
vi.mock('../../src/ts/autotag.js', () => ({ mergeTags: mockMergeTags }));
vi.mock('../../src/ts/utils.js', () => ({
  naturalCompare: mockNaturalCompare, nowSec: vi.fn(() => Date.now()/1000),
  createListenerList: vi.fn(() => ({ subscribe: vi.fn(() => vi.fn()), notify: vi.fn() })),
  formatTimestamp: vi.fn((ts: number) => new Date(ts*1000).toISOString()),
  esc: vi.fn((s: string) => s), fmtSize: vi.fn((b: number) => `${b} B`),
}));

import TagView from '../../src/ts/components/TagView.js';

function mn(id: string) {
  return { id, created_at: 1000, updated_at: 2000, current: 'local', created_by: '', updated_by: '' };
}

beforeEach(() => {
  mockDbGetNote.mockResolvedValue({ content: '', id: '', created_at: 1, updated_at: 2, deleted: 0, current: 'local', updated_by: '', created_by: '' });
  mockParseFrontmatter.mockReturnValue({ meta: {}, body: '' });
  mockNaturalCompare.mockImplementation((a: string, b: string) => a.localeCompare(b));
  mockMergeTags.mockImplementation((user: string[], _auto: string[]) => user);
});

describe('Loading & empty states', () => {
  it('shows loading indicator', () => {
    let r!: (v: any) => void;
    const d = new Promise<any>(res => { r = res; });
    mockDbGetNote.mockReturnValue(d);
    const { unmount } = render(<TagView notes={[mn('a.md')]} activeNoteId={null} searchQuery="" onOpen={vi.fn()} />);
    expect(screen.getByText('Loading tags…')).toBeInTheDocument();
    r({ content: '', id: 'a', created_at: 1, updated_at: 2, deleted: 0, current: 'local', updated_by: '', created_by: '' });
    unmount();
  });

  it('shows untagged section', async () => {
    mockDbGetNote.mockResolvedValue({ content: 't', id: 'n', created_at: 1, updated_at: 2, deleted: 0, current: 'local', updated_by: '', created_by: '' });
    mockParseFrontmatter.mockReturnValue({ meta: {}, body: 't' });
    render(<TagView notes={[mn('plain.md')]} activeNoteId={null} searchQuery="" onOpen={vi.fn()} />);
    await waitFor(() => { expect(screen.getByText('Untagged')).toBeInTheDocument(); });
  });

  it('shows "No tags" when empty', async () => {
    render(<TagView notes={[]} activeNoteId={null} searchQuery="" onOpen={vi.fn()} />);
    await waitFor(() => { expect(screen.getByText('No tags')).toBeInTheDocument(); });
  });
});

describe('Search filter', () => {
  it('shows "No matching tags or notes"', async () => {
    mockDbGetNote.mockResolvedValue({ content: '---\nuser-tags: [work]\n---\nbody', id: 'n.md', created_at: 1, updated_at: 2, deleted: 0, current: 'local', updated_by: '', created_by: '' });
    mockParseFrontmatter.mockReturnValue({ meta: { 'user-tags': ['work'] }, body: 'body' });
    render(<TagView notes={[mn('n.md')]} activeNoteId={null} searchQuery="xyzzy" onOpen={vi.fn()} />);
    await waitFor(() => { expect(screen.getByText('No matching tags or notes')).toBeInTheDocument(); });
  });

  it('filters out non-matching tags', async () => {
    mockDbGetNote.mockImplementation(async (id: string) => {
      if (id === 'match.md') return { content: '---\nuser-tags: [work]\n---\nbody', id, created_at: 1, updated_at: 2, deleted: 0, current: 'local', updated_by: '', created_by: '' };
      return { content: '---\nuser-tags: [personal]\n---\nbody', id, created_at: 1, updated_at: 2, deleted: 0, current: 'local', updated_by: '', created_by: '' };
    });
    mockParseFrontmatter.mockImplementation((content: string) => {
      if (content.includes('[work')) return { meta: { 'user-tags': ['work'] }, body: 'body' };
      return { meta: { 'user-tags': ['personal'] }, body: 'body' };
    });
    render(<TagView notes={[mn('match.md'), mn('other.md')]} activeNoteId={null} searchQuery="work" onOpen={vi.fn()} />);
    await waitFor(() => { expect(screen.getByText('work')).toBeInTheDocument(); });
    expect(screen.queryByText('personal')).toBeNull();
  });
});
