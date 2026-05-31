/**
 * task-lists.ts — markdown-it-task-lists plugin wrapper
 *
 * Renders GitHub-style task lists: `- [ ]` and `- [x]` become checkboxes.
 * Thin adapter that wires the third-party plugin into our `use()` API so
 * it can be activated by name from the server config.
 *
 * Options (passed as the second element of the config tuple):
 *   enabled: boolean  — if true, checkboxes are interactive (no disabled attr).
 *                       Default: false (checkboxes are disabled/read-only).
 *   label:   boolean  — if true, wraps checkbox + text in <label> for
 *                       larger click targets.  Default: false.
 *   labelAfter: boolean — if true, uses <label for="..."> after the checkbox
 *                          instead of wrapping.  Requires `label: true`.
 *                          Default: false.
 */

import type MarkdownIt from 'markdown-it';
import taskListsPlugin from 'markdown-it-task-lists';
import { registerSystemNote } from '../system-notes/registry.js';
import taskListsDocs from './task-lists-docs.md';

registerSystemNote({
  id: '@help:markdown:task-lists',
  label: 'Task Lists',
  content: () => taskListsDocs,
});

export interface TaskListsOptions {
  enabled?: boolean;
  label?: boolean;
  labelAfter?: boolean;
}

const plugin: (md: MarkdownIt, options?: TaskListsOptions) => void = (md, opts) => {
  md.use(taskListsPlugin, {
    enabled: opts?.enabled ?? false,
    label: opts?.label ?? false,
    labelAfter: opts?.labelAfter ?? false,
  });
};

export default plugin;
