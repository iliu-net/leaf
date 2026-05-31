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

registerSystemNote({ id: '@help',                 content: () => helpMd,          label: 'Help' });
registerSystemNote({ id: '@help:about',            content: () => aboutMd,         label: 'About' });
registerSystemNote({ id: '@help:copyright',        content: () => copyrightMd,     label: 'Copyright' });
registerSystemNote({ id: '@help:shortcuts',        content: () => helpShortcutsMd, label: 'Shortcuts' });
registerSystemNote({ id: '@help:markdown',         content: () => helpMarkdownMd,  label: 'Markdown' });
registerSystemNote({ id: '@help:codemirror',       content: () => helpCodemirrorMd, label: 'CodeMirror' });
registerSystemNote({ id: '@help:autotag',          content: () => helpAutotagMd,   label: 'Auto-tagging' });
