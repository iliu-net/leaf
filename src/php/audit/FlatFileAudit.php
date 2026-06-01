<?php

/**
 * FlatFileAudit — monthly JSONL file audit log backend.
 *
 * Stores audit entries in data/audit-YYYY-MM.jsonl files (one per calendar
 * month).  Each entry is a single JSON line appended with flock() for
 * concurrent-write safety.
 *
 * When running under PHP's built-in dev server (php -S), audit entries
 * are additionally mirrored to stderr (via error_log) for inline terminal
 * visibility — but only the file write is guaranteed.
 *
 * Purging: unlink() entire monthly files older than the retention period.
 * A file is eligible when the first day of the following month is more
 * than $retentionDays in the past.
 *
 * Constructor parameters mirror the old config constants:
 *   $dataRoot       → was DATA_ROOT
 *   $logIps         → was AUDIT_LOG_IPS
 *   $retentionDays  → was AUDIT_RETENTION_DAYS
 */
class FlatFileAudit implements AuditInterface
{
    private readonly string $auditDir;

    public function __construct(
        private readonly string $dataRoot,
        private readonly bool   $logIps = true,
        private readonly int    $retentionDays = 90,
    ) {
        $this->auditDir = rtrim($dataRoot, '/') . '/';
    }

    /**
     * Append one entry to the audit log.
     */
    public function log(string $event, array $data = []): void
    {
        $entry = [
            'ts'    => time(),
            'event' => $event,
        ] + $data;

        if ($this->logIps) {
            $entry['ip'] = $_SERVER['REMOTE_ADDR'] ?? 'cli';
        }

        $line = json_encode($entry, JSON_UNESCAPED_UNICODE) . "\n";

        // Dev server: mirror to stderr with timestamp prefix
        if (PHP_SAPI === 'cli-server') {
            $prefix = '[' . gmdate('D M d H:i:s Y') . '] AUDIT: ';
            error_log($prefix . rtrim($line));
        }

        // Always write to the monthly file
        $file = $this->auditDir . 'audit-' . gmdate('Y-m') . '.jsonl';
        $fh   = fopen($file, 'a');
        if (!$fh) return;
        flock($fh, LOCK_EX);
        fwrite($fh, $line);
        flock($fh, LOCK_UN);
        fclose($fh);
    }

    /**
     * Purge audit files older than retentionDays.
     */
    public function purge(string $entry): int
    {
        $cutoff  = time() - ($this->retentionDays * 86400);
        $removed = 0;

        foreach (glob($this->auditDir . 'audit-*.jsonl') ?: [] as $file) {
            $basename = basename($file, '.jsonl');   // audit-2026-03
            $ym       = substr($basename, 6);         // 2026-03

            // Validate format to avoid accidentally deleting unrelated files
            if (!preg_match('/^\d{4}-\d{2}$/', $ym)) continue;

            // First day of the following month is when this file is "complete"
            $nextMonthTs = strtotime($ym . '-01 +1 month');
            if ($nextMonthTs === false) continue;

            if ($nextMonthTs < $cutoff) {
                unlink($file);
                $removed++;
            }
        }

        return $removed;
    }
}
