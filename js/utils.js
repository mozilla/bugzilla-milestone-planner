/**
 * Shared utility functions
 * Works in browsers, workers, and Node.js
 */

/**
 * Escape HTML special characters (pure string replacement, no DOM needed)
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * Format a Date as YYYY-MM-DD using local timezone getters
 * @param {Date} date
 * @returns {string}
 */
export function formatLocalDate(date) {
  if (!date) return 'N/A';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Whether debug logging is enabled (?debug URL param or localStorage.DEBUG)
 */
export const DEBUG = (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' && localStorage.getItem('DEBUG') === 'true')
  || (typeof location !== 'undefined' && typeof location.search === 'string' && new URLSearchParams(location.search).has('debug'));

/**
 * Log to console only when debug mode is enabled
 */
export function debugLog(...args) { if (DEBUG) console.log(...args); }
