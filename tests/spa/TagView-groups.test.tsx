/**
 * D2b — TagView component tests (part 2: groups, click, highlight)
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

// WARMUP: render-and-unmount to prime module-level mock state
it('_warmup_render_', async () => {
  mockDbGetNote.mockResolvedValue({ content: 'x', id: 'x', created_at: 1, updated_at: 2, deleted: 0, current: 'local', updated_by: '', created_by: '' });
  mockParseFrontmatter.mockReturnValue({ meta: {}, body: '' });
  const { unmount } = render(<TagView notes={[]} activeNoteId={null} searchQuery="" onOpen={vi.fn()} />);
  await waitFor(() => { expect(screen.getByText('No tags')).toBeInTheDocument(); });
  unmount();
});

describe('Tag groups rendering', () => {
  it('renders tag groups as accordion items', async () => {
    mockDbGetNote.mockImplementation(async (id: string) => {
      if (id === 'recipes.md') return { content: '---\nuser-tags: [cooking, food]\n---\nbody', id, created_at: 1, updated_at: 2, deleted: 0, current: 'local', updated_by: '', created_by: '' };
      return { content: '---\nuser-tags: [personal]\n---\nbody', id, created_at: 1, updated_at: 2, deleted: 0, current: 'local', updated_by: '', created_by: '' };
    });
    mockParseFrontmatter.mockImplementation((content: string) => {
      if (content.includes('[cooking')) return { meta: { 'user-tags': ['cooking', 'food'] }, body: 'body' };
      return { meta: { 'user-tags': ['personal'] }, body: 'body' };
    });
    render(<TagView notes={[mn('recipes.md'), mn('todo.md')]} activeNoteId={null} searchQuery="" onOpen={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('cooking')).toBeInTheDocument();
    });
  });

  it('shows tag count', async () => {
    mockDbGetNote.mockImplementation(async (id: string) => ({ content: '---\nuser-tags: [shared]\n---\nbody', id, created_at: 1, updated_at: 2, deleted: 0, current: 'local', updated_by: '', created_by: '' }));
    mockParseFrontmatter.mockReturnValue({ meta: { 'user-tags': ['shared'] }, body: 'body' });
    render(<TagView notes={[mn('a.md'), mn('b.md')]} activeNoteId={null} searchQuery="" onOpen={vi.fn()} />);
    await waitFor(() => { expect(screen.getByText('shared')).toBeInTheDocument(); });
    const counts = document.querySelectorAll('.tag-count');
    expect(Array.from(counts).map(el => el.textContent)).toContain('2');
  });

  it('auto-expands first group', async () => {
    mockDbGetNote.mockImplementation(async (id: string) => ({ content: '---\nuser-tags: [alpha]\n---\nbody', id, created_at: 1, updated_at: 2, deleted: 0, current: 'local', updated_by: '', created_by: '' }));
    mockParseFrontmatter.mockReturnValue({ meta: { 'user-tags': ['alpha'] }, body: 'body' });
    render(<TagView notes={[mn('n.md')]} activeNoteId={null} searchQuery="" onOpen={vi.fn()} />);
    await waitFor(() => { expect(screen.getByText('alpha')).toBeInTheDocument(); });
    expect(document.querySelector('.tree-toggle')?.textContent).toBe('▼');
  });
});

describe('Note click → onOpen', () => {
  it('calls onOpen', async () => {
    mockDbGetNote.mockResolvedValue({ content: '---\nuser-tags: [tag]\n---\nbody', id: 'n.md', created_at: 1, updated_at: 2, deleted: 0, current: 'local', updated_by: '', created_by: '' });
    mockParseFrontmatter.mockReturnValue({ meta: { 'user-tags': ['tag'] }, body: 'body' });
    const onOpen = vi.fn();
    render(<TagView notes={[mn('n.md')]} activeNoteId={null} searchQuery="" onOpen={onOpen} />);
    await waitFor(() => { expect(document.querySelector('.tag-accordion-content')?.getAttribute('data-state')).toBe('open'); });
    (document.querySelector('.file-item') as HTMLElement)?.click();
    expect(onOpen).toHaveBeenCalledWith('n.md');
  });
});

describe('Active note highlight', () => {
  it('adds .active class', async () => {
    mockDbGetNote.mockResolvedValue({ content: '---\nuser-tags: [tag]\n---\nbody', id: 'active.md', created_at: 1, updated_at: 2, deleted: 0, current: 'local', updated_by: '', created_by: '' });
    mockParseFrontmatter.mockReturnValue({ meta: { 'user-tags': ['tag'] }, body: 'body' });
    render(<TagView notes={[mn('active.md')]} activeNoteId="active.md" searchQuery="" onOpen={vi.fn()} />);
    await waitFor(() => { expect(document.querySelector('.tag-accordion-content')?.getAttribute('data-state')).toBe('open'); });
    const noteRow = document.querySelector('.file-item') as HTMLElement;
    expect(noteRow.classList.contains('active')).toBe(true);
  });
});
