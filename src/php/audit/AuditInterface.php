<?php

/**
 * AuditInterface — contract for audit log backends.
 *
 * Implementations must provide append-only event logging and periodic
 * purging of entries older than the configured retention period.
 */
interface AuditInterface
{
    /**
     * Append one entry to the audit log.
     *
     * @param string $event  Event type (AUTH_LOGIN, NOTE_WRITE, etc.)
     * @param array  $data   Additional key/value pairs merged into the entry
     *                       (e.g. ['user' => 'alice', 'note_id' => 'welcome'])
     * @return void
     */
    public function log(string $event, array $data = []): void;

    /**
     * Purge audit entries older than the configured retention period.
     *
     * @param string $entry  Entry point identification (e.g. 'sync')
     * @return int           Number of entries/files removed
     */
    public function purge(string $entry): int;
}
