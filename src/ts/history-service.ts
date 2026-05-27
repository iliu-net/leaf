/**
 * history-service.ts — version history
 *
 * All server communication delegated to api.ts.
 * Re-exports types and fetch functions for backward compatibility
 * (history-view.ts imports from here).
 */

export { fetchVersionList, fetchVersionContent } from './api.js';
export type { VersionMeta, VersionListResponse } from './api.js';
