/**
 * utils.ts — shared utility functions
 *
 * Pure functions with no dependencies, safe to import anywhere
 * (including tests without a full browser environment).
 */

/**
 * Sanitize a user-supplied note name into a safe filesystem-friendly identifier.
 *
 * Maps slashes to colons, replaces leading dots with underscore, strips
 * unsafe characters, and truncates to 80 characters.
 *
 * @param raw  Raw user input
 * @returns    Sanitized safe identifier
 */
export function safeName(raw: string): string {
  let name = raw.trim();
  name = name.replace(/\//g, ':');
  name = name.replace(/^\.+/, '_');
  name = name.replace(/[^a-zA-Z0-9_\-\.$%'@~!(){}^#&`:]/g, '_');
  return name.slice(0, 80);
}
