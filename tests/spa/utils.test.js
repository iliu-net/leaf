/**
 * Tests for spa/js/utils.js — pure functions, no mocking needed.
 */

import { describe, it, expect } from 'vitest';
import { safeName } from '../../spa/js/utils.js';

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
    expect(safeName('hello world')).toBe('hello_world');
    // ! is safe (it's in the allowed special chars set)
    expect(safeName('hello world!!!')).toBe('hello_world!!!');
  });

  it('preserves safe special characters', () => {
    expect(safeName('my-note_v2')).toBe('my-note_v2');
    expect(safeName("note$%'@~!(){}^#&`")).toBe("note$%'@~!(){}^#&`");
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
    // ! is safe, parens are safe, space → underscore
    expect(safeName('  My Cool Note!!! (v1)  ')).toBe('My_Cool_Note!!!_(v1)');
  });

  it('replaces angle brackets', () => {
    expect(safeName('<script>')).toBe('_script_');
  });

  it('replaces pipe characters', () => {
    expect(safeName('a|b|c')).toBe('a_b_c');
  });

  it('replaces unicode characters with underscore', () => {
    expect(safeName('naïve café')).toBe('na_ve_caf_');
  });

  it('allows @ symbol in names', () => {
    expect(safeName('note@#$%^')).toBe('note@#$%^');
  });
});
