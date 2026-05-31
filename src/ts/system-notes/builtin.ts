/**
 * builtin.ts — registers all built-in system notes
 *
 * Adding a new page is two lines: one import, one register call.
 */

import { registerSystemNote } from './registry.js';
import aboutMd            from './content/about.md';
import copyrightMd        from './content/copyright.md';
import helpMd             from './content/help.md';
import helpShortcutsMd    from './content/help-shortcuts.md';
import helpMarkdownMd     from './content/help-markdown.md';
import helpCodemirrorMd   from './content/help-codemirror.md';
import helpAutotagMd      from './content/help-autotag.md';

registerSystemNote({ id: '@about',                 content: () => aboutMd,         label: 'About' });
registerSystemNote({ id: '@about:copyright',        content: () => copyrightMd,     label: 'Copyright' });
registerSystemNote({ id: '@about:help',             content: () => helpMd,          label: 'Help' });
registerSystemNote({ id: '@about:help:shortcuts',   content: () => helpShortcutsMd, label: 'Shortcuts' });
registerSystemNote({ id: '@about:help:markdown',    content: () => helpMarkdownMd,  label: 'Markdown' });
registerSystemNote({ id: '@about:help:codemirror',  content: () => helpCodemirrorMd, label: 'CodeMirror' });
registerSystemNote({ id: '@about:help:autotag',     content: () => helpAutotagMd,   label: 'Auto-tagging' });
