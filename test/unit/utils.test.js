import { describe, it, expect } from 'vitest';
import { escapeHtml, formatLocalDate } from '../../js/utils.js';

describe('escapeHtml', () => {
  it('returns empty string for falsy input', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes quotes', () => {
    expect(escapeHtml('"hello" & \'world\'')).toBe('&quot;hello&quot; &amp; &#039;world&#039;');
  });

  it('returns plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('formatLocalDate', () => {
  it('returns N/A for falsy input', () => {
    expect(formatLocalDate(null)).toBe('N/A');
    expect(formatLocalDate(undefined)).toBe('N/A');
  });

  it('formats a date as YYYY-MM-DD', () => {
    const d = new Date(2026, 2, 11); // March 11, 2026 (month is 0-indexed)
    expect(formatLocalDate(d)).toBe('2026-03-11');
  });

  it('pads single-digit month and day', () => {
    const d = new Date(2026, 0, 5); // Jan 5, 2026
    expect(formatLocalDate(d)).toBe('2026-01-05');
  });
});
