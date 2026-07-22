<?php
/**
 * cron_impl.php — periodic maintenance tasks (called via cron)
 *
 * Invoked by the CLI router in api/index.php:
 *   php api/index.php cron [--verbose]
 *
 * Designed to run every 15-30 minutes.  Safe to run concurrently
 * (housekeeping operations are idempotent or flock-guarded).
 *
 * Performs:
 *   1. Storage housekeeping  — purge expired tombstones,
 *      flush staged writes, commit trailing changelog (GitStorage)
 *   2. Audit log purge       — delete audit files older than
 *      AUDIT_RETENTION_DAYS
 *   3. Track last run time   — update last_purge.txt so the sync.php
 *      lazy trigger doesn't race with cron
 *
 * Runs silently by default (suitable for cron).  Pass --verbose
 * for diagnostic output (changelog revs, .meta file count, etc.).
 */

require_once __DIR__ . '/storage.php';
require_once __DIR__ . '/audit.php';

$verbose = ($argv[2] ?? '') === '--verbose';

// ── Storage housekeeping ─────────────────────────────────────

$changelogBefore = $verbose ? storage()->changelogCurrentRev() : 0;

$storageRemoved = storage()->housekeeping('cron');

$changelogAfter = $verbose ? storage()->changelogCurrentRev() : 0;

// ── Audit log purge ──────────────────────────────────────────

$auditRemoved = audit()->purge('cron');

// ── Update last-run timestamp ────────────────────────────────
// Prevents sync.php's lazy trigger from re-running within the
// same 24-hour window if cron already did the work.

$purgeFile = defined('DATA_ROOT') ? DATA_ROOT . 'last_purge.txt' : null;
if ($purgeFile !== null) {
    file_put_contents($purgeFile, (string)time());
}

// ── Verbose output ───────────────────────────────────────────

if ($verbose) {
    printf("[%s] storage housekeeping: %d tombstones purged\n",
           date('c'), $storageRemoved);
    printf("[%s] changelog rev: %d → %d\n",
           date('c'), $changelogBefore, $changelogAfter);
    printf("[%s] audit purge: %d files removed\n",
           date('c'), $auditRemoved);

    // Count remaining .meta files (GitStorage staging artifacts)
    $notesDir = rtrim(DATA_ROOT, '/') . '/notes/';
    $metaCount = 0;
    if (is_dir($notesDir)) {
        $it = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($notesDir, \RecursiveDirectoryIterator::SKIP_DOTS)
        );
        foreach ($it as $f) {
            if ($f->getExtension() === 'meta') $metaCount++;
        }
    }
    printf("[%s] staged .meta files remaining: %d\n",
           date('c'), $metaCount);
}

exit(0);
