/**
 * emoji.ts — markdown-it-emoji plugin wrapper
 *
 * Thin adapter that wires the third-party markdown-it-emoji plugin into
 * our `use()` API so it can be activated by name from the server config.
 */

import type MarkdownIt from 'markdown-it';
import { full as emojiPlugin } from 'markdown-it-emoji';
import { registerSystemNote } from '../system-notes/registry.js';
import emojiDocs from './emoji-docs.md';

registerSystemNote({
  id: '@help:markdown:emoji',
  label: 'Emoji',
  content: () => emojiDocs,
});

const plugin: (md: MarkdownIt) => void = (md) => md.use(emojiPlugin);
export default plugin;
