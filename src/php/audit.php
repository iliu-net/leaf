<?php
/**
 * audit.php — append-only audit log (authentication + note access)
 *
 * Usage:
 *   require_once __DIR__ . '/audit.php';
 *   audit_log('AUTH_LOGIN', ['user' => $username]);
 *   audit_log('NOTE_WRITE', ['user' => $author, 'note_id' => $key, 'version' => $vkey]);
 *
 * Storage: monthly JSONL files under data/
 *   data/audit-2026-05.jsonl    ← current month (appends go here)
 *   data/audit-2026-04.jsonl
 *   data/audit-2026-03.jsonl
 *
 * When running under PHP's built-in dev server (php -S), audit entries
 * are written to stderr (via error_log) for inline terminal visibility
 * AND to the monthly file (so the file code path is exercised during
 * development).
 *
 * In production (Apache / nginx / php-fpm): file only.
 *
 * Purging is atomic: unlink() entire monthly files older than
 * AUDIT_RETENTION_DAYS.  Called once per day by the purge hook in sync.php.
 *
 * Event types:
 *   AUTH_LOGIN       — successful login
 *   AUTH_LOGIN_FAIL  — failed login attempt
 *   AUTH_REFRESH     — access-token refresh via refresh_token cookie
 *   AUTH_LOGOUT      — explicit logout
 *   NOTE_WRITE       — CREATE or UPDATE applied to a note
 *   NOTE_DELETE      — DELETE applied to a note
 *   NOTE_RENAME      — RENAME applied to a note
 *   NOTE_READ        — note content delivered to a client during sync
 *
 * Schema (one JSON object per line):
 *   {
 *     "ts":      1716163200,                        // server timestamp (UTC)
 *     "event":   "NOTE_WRITE",
 *     "user":    "alice",
 *     "ip":      "192.168.1.1",                     // only when AUDIT_LOG_IPS=true
 *     "note_id": "welcome",                         // note events only
 *     "version": "2026-05-26:1:alice",              // note read/write only
 *     "renamed_to": "new-id"                        // note rename only
 *   }
 */

/**
 * Append one entry to the audit log.
 *
 * In production:  writes to the current month's data/audit-YYYY-MM.jsonl file
 *                 using flock() for concurrent-write safety.
 * In dev server:  additionally writes to stderr (via error_log) so entries
 *                 appear inline in the php -S terminal output.
 *
 * @param string $event  Event type (AUTH_LOGIN, NOTE_WRITE, etc.)
 * @param array  $data   Additional key/value pairs merged into the entry
 *                       (e.g. ['user' => 'alice', 'note_id' => 'welcome'])
 * @return void
 */
function audit_log(string $event, array $data = []): void {
    $entry = [
        'ts'    => time(),
        'event' => $event,
    ] + $data;

    if (AUDIT_LOG_IPS) {
        $entry['ip'] = $_SERVER['REMOTE_ADDR'] ?? 'cli';
    }

    $line = json_encode($entry, JSON_UNESCAPED_UNICODE) . "\n";

    // Dev server: mirror to stderr with timestamp prefix matching PHP's format
    if (PHP_SAPI === 'cli-server') {
        $prefix = '[' . gmdate('D M d H:i:s Y') . '] AUDIT: ';
        error_log($prefix . rtrim($line));
    }

    // Always write to the monthly file
    $file = DATA_ROOT . 'audit-' . gmdate('Y-m') . '.jsonl';
    $fh   = fopen($file, 'a');
    if (!$fh) return;
    flock($fh, LOCK_EX);
    fwrite($fh, $line);
    flock($fh, LOCK_UN);
    fclose($fh);
}

/**
 * Purge audit files older than AUDIT_RETENTION_DAYS.
 *
 * Called by the daily purge hook in sync.php.  Each file covers one calendar
 * month.  A file is eligible for removal when the first day of the following
 * month is more than AUDIT_RETENTION_DAYS in the past — i.e. the entire
 * month's data has been retained for at least the configured period.
 *
 * Purging is a single unlink() per file — no line scanning needed.
 *
 * @param string $entry Entry point from housekeeping
 * @return int  Number of monthly audit files removed
 */
function audit_purge(string $entry): int {
    $cutoff  = time() - (AUDIT_RETENTION_DAYS * 86400);
    $removed = 0;

    foreach (glob(DATA_ROOT . 'audit-*.jsonl') ?: [] as $file) {
        $basename = basename($file, '.jsonl');   // audit-2026-03
        $ym       = substr($basename, 6);         // 2026-03

        // Validate format to avoid accidentally deleting unrelated files
        if (!preg_match('/^\d{4}-\d{2}$/', $ym)) continue;

        // First day of the following month is when this file is "complete"
        $next_month_ts = strtotime($ym . '-01 +1 month');
        if ($next_month_ts === false) continue;

        if ($next_month_ts < $cutoff) {
            unlink($file);
            $removed++;
        }
    }

    return $removed;
}
