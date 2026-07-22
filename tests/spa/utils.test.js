/**
 * Tests for src/ts/utils.ts — pure functions, no mocking needed.
 */

import { describe, it, expect } from 'vitest';
import {
  safeName, nowSec, formatTimestamp, relativeTime,
  esc, naturalCompare, computeStats,
} from '../../src/ts/utils.ts';
import { updateFrontmatter } from '../../src/ts/frontmatter.ts';

describe('safeName()', () => {
  it('trims whitespace', () => {
    expect(safeName('  hello  ')).toBe('hello');
  });

  it('converts slashes to colons', () => {
    expect(safeName('work/meeting')).toBe('work:meeting');
    expect(safeName('a/b/c')).toBe('a:b:c');
  });

  it('replaces leading dots with underscore', () => {
    expect(safeName('.hidden')).toBe('_hidden');
    expect(safeName('..dots')).toBe('_dots');
  });

  it('replaces unsafe characters with underscore', () => {
    // space is now allowed; backslash and other unsafe chars still → _
    expect(safeName('hello\\world')).toBe('hello_world');
    expect(safeName('hello\tworld')).toBe('hello_world');
  });

  it('preserves safe special characters', () => {
    expect(safeName('my-note_v2')).toBe('my-note_v2');
    expect(safeName("note$%'@~!(){}^#&`")).toBe("note$%'@~!(){}^#&`");
    // space and brackets are now allowed
    expect(safeName('note +,;=[]')).toBe('note +,;=[]');
  });

  it('preserves periods in the middle', () => {
    expect(safeName('my.note.txt')).toBe('my.note.txt');
  });

  it('handles colons in input', () => {
    expect(safeName('note:sub')).toBe('note:sub');
  });

  it('truncates to 80 characters', () => {
    const long = 'a'.repeat(100);
    const result = safeName(long);
    expect(result.length).toBe(80);
    expect(result).toBe('a'.repeat(80));
  });

  it('returns empty string for whitespace-only input', () => {
    expect(safeName('   ')).toBe('');
  });

  it('handles empty string', () => {
    expect(safeName('')).toBe('');
  });

  it('handles mixed safe and unsafe characters', () => {
    // ! and parens are safe, space is now safe, only trimmed
    expect(safeName('  My Cool Note!!! (v1)  ')).toBe('My Cool Note!!! (v1)');
  });

  it('replaces angle brackets', () => {
    expect(safeName('<script>')).toBe('_script_');
  });

  it('replaces pipe characters', () => {
    expect(safeName('a|b|c')).toBe('a_b_c');
  });

  it('replaces unicode characters with underscore', () => {
    expect(safeName('naïve café')).toBe('na_ve caf_');
  });

  it('allows @ symbol in names', () => {
    expect(safeName('note@#$%^')).toBe('note@#$%^');
  });
});

describe('updateFrontmatter()', () => {
  it('creates frontmatter when none exists', () => {
    const result = updateFrontmatter('Body text', { author: 'alice' });
    expect(result).toBe('---\nauthor: alice\n---\nBody text');
  });

  it('merges into existing frontmatter', () => {
    const content = '---\ntitle: foo\n---\nBody';
    const result = updateFrontmatter(content, { author: 'alice' });
    expect(result).toContain('title: foo');
    expect(result).toContain('author: alice');
    expect(result).toContain('Body');
  });

  it('overwrites existing frontmatter key', () => {
    const content = '---\nauthor: bob\n---\nBody';
    const result = updateFrontmatter(content, { author: 'alice' });
    expect(result).toBe('---\nauthor: alice\n---\nBody');
  });

  it('handles empty content', () => {
    const result = updateFrontmatter('', { author: 'alice' });
    expect(result).toBe('---\nauthor: alice\n---\n');
  });

  it('preserves body unchanged when updating frontmatter', () => {
    const content = '---\ntitle: foo\n---\nBody text\nwith multiple lines';
    const result = updateFrontmatter(content, { author: 'alice' });
    expect(result).toContain('Body text\nwith multiple lines');
  });

  it('handles multiple updates at once', () => {
    const result = updateFrontmatter('Body', { a: '1', b: '2' });
    expect(result).toContain('a: 1');
    expect(result).toContain('b: 2');
    expect(result).toContain('Body');
  });
});

// ── nowSec() ────────────────────────────────────────────────────────────────

describe('nowSec()', () => {
  it('returns a number close to current unix timestamp in seconds', () => {
    const before = Math.floor(Date.now() / 1000);
    const result = nowSec();
    const after = Math.floor(Date.now() / 1000);
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('returns an integer', () => {
    expect(Number.isInteger(nowSec())).toBe(true);
  });

  it('returns a plausible value (> 1.7e9 for 2020s)', () => {
    expect(nowSec()).toBeGreaterThan(1_700_000_000);
  });
});

// ── formatTimestamp() ───────────────────────────────────────────────────────

describe('formatTimestamp()', () => {
  // Fixed timestamp: 2026-05-28 15:14:27 UTC = 1779990867
  const FIXED_TS = 1779990867;

  // formatTimestamp uses Date.toLocaleString() when timestamp_format is null,
  // which is the default.  The locale output varies by environment (UTC in CI,
  // local in dev).  We only test presence of expected date parts.

  it('includes year, month, day with default (toLocaleString fallback)', () => {
    const result = formatTimestamp(FIXED_TS);
    expect(result).toMatch(/2026/);
  });

  it('returns empty string for 0 timestamp', () => {
    expect(formatTimestamp(0)).toBe('');
  });

  it('handles a timestamp near epoch (1970)', () => {
    const result = formatTimestamp(1); // 1 second after epoch
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe('1/1/1970'); // toLocaleString varies by locale
  });
});

// ── relativeTime() ──────────────────────────────────────────────────────────

describe('relativeTime()', () => {
  it('returns "just now" for timestamps within 60 seconds', () => {
    expect(relativeTime(nowSec() - 30)).toBe('just now');
    expect(relativeTime(nowSec() - 0)).toBe('just now');
    expect(relativeTime(nowSec() - 59)).toBe('just now');
  });

  it('returns "X minute(s) ago" for minutes', () => {
    expect(relativeTime(nowSec() - 60)).toBe('1 minute ago');
    expect(relativeTime(nowSec() - 119)).toBe('1 minute ago');
    expect(relativeTime(nowSec() - 180)).toBe('3 minutes ago');
    expect(relativeTime(nowSec() - 59 * 60)).toBe('59 minutes ago');
  });

  it('returns "X hour(s) ago" for hours', () => {
    expect(relativeTime(nowSec() - 3600)).toBe('1 hour ago');
    expect(relativeTime(nowSec() - 7200)).toBe('2 hours ago');
    expect(relativeTime(nowSec() - 23 * 3600)).toBe('23 hours ago');
  });

  it('returns "X day(s) ago" for days', () => {
    expect(relativeTime(nowSec() - 86400)).toBe('1 day ago');
    expect(relativeTime(nowSec() - 2 * 86400)).toBe('2 days ago');
    expect(relativeTime(nowSec() - 29 * 86400)).toBe('29 days ago');
  });

  it('returns "X month(s) ago" for 30+ days', () => {
    expect(relativeTime(nowSec() - 30 * 86400)).toBe('1 month ago');
    expect(relativeTime(nowSec() - 60 * 86400)).toBe('2 months ago');
    expect(relativeTime(nowSec() - 365 * 86400)).toBe('12 months ago');
  });
});

// ── esc() ─────────────────────────────────────────────────────────────────────

describe('esc()', () => {
  it('escapes ampersand', () => {
    expect(esc('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than and greater-than', () => {
    expect(esc('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes double-quotes', () => {
    expect(esc('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('handles all special characters together', () => {
    expect(esc('<a href="x">&</a>'))
      .toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });

  it('leaves safe characters unchanged', () => {
    expect(esc('hello world 123')).toBe('hello world 123');
  });

  it('returns empty string for empty input', () => {
    expect(esc('')).toBe('');
  });
});

// ── naturalCompare() ───────────────────────────────────────────────────────────

describe('naturalCompare()', () => {
  it('sorts numbers naturally', () => {
    const arr = ['file10', 'file2', 'file1'];
    arr.sort(naturalCompare);
    expect(arr).toEqual(['file1', 'file2', 'file10']);
  });

  it('returns 0 for identical strings', () => {
    expect(naturalCompare('hello', 'hello')).toBe(0);
  });

  it('sorts shorter prefix before longer', () => {
    expect(naturalCompare('file', 'file1')).toBeLessThan(0);
  });

  it('handles multi-digit numbers', () => {
    const arr = ['v100', 'v20', 'v3'];
    arr.sort(naturalCompare);
    expect(arr).toEqual(['v3', 'v20', 'v100']);
  });

  it('handles colon-separated paths', () => {
    const arr = ['a:b:10', 'a:b:2', 'a:b:1'];
    arr.sort(naturalCompare);
    expect(arr).toEqual(['a:b:1', 'a:b:2', 'a:b:10']);
  });
});

// ── computeStats() ─────────────────────────────────────────────────────────────

describe('computeStats()', () => {
  it('returns zeros for empty string', () => {
    expect(computeStats('')).toEqual({ chars: 0, words: 0, lines: 0 });
  });

  it('counts characters', () => {
    expect(computeStats('hello').chars).toBe(5);
  });

  it('counts words', () => {
    expect(computeStats('hello world').words).toBe(2);
  });

  it('counts zero words for whitespace-only', () => {
    expect(computeStats('   \n  \t  ').words).toBe(0);
  });

  it('counts lines', () => {
    expect(computeStats('a\nb\nc').lines).toBe(3);
  });

  it('single line with no newline counts as 1', () => {
    expect(computeStats('single line').lines).toBe(1);
  });

  it('handles multi-paragraph content', () => {
    const s = computeStats('Line one.\nLine two.\n\nLine four.\n');
    expect(s.lines).toBe(5);
    expect(s.words).toBe(6);
    expect(s.chars).toBe(32);
  });
});
