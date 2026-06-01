<?php
/**
 * StorageInterface.php — storage backend contract
 *
 * Every storage backend (flat-file, MySQL, etc.) implements this interface
 * so consumers (sync.php, trash.php, history.php) work against any backend
 * without changes.
 *
 * Methods are grouped by concern.  Internal helpers that only exist to
 * support the flat-file layout (path building, raw put/delete without
 * changelog) are NOT on the interface — they're private on each class.
 *
 * To add a new backend:
 *   1. Create a class that implements this interface.
 *   2. Wire it in config.php:  storage_set(new MyBackend(...));
 *   3. Done — all consumers get the new backend automatically.
 */

interface StorageInterface
{
    // ── Note reads ─────────────────────────────────────────────────────

    /** Check whether a note has been soft-deleted. */
    public function noteDeleted(string $id): bool;

    /** Read a live note (null if deleted or missing). */
    public function getNote(string $id): ?array;

    /**
     * Read a note in flat shape for sync-protocol consumers.
     * Hides the internal versions map.  Null if not found or deleted.
     */
    public function getNoteFull(string $id, int $clientId): ?array;

    /** Return metadata for all live notes, sorted by id. */
    public function listNotes(): array;

    // ── Tombstones ─────────────────────────────────────────────────────

    /** Return metadata for all soft-deleted notes. */
    public function listDeletedNotes(): array;

    /**
     * Return tombstone data in a normalized flat shape.
     * Null if the tombstone does not exist.
     */
    public function getTombstone(string $id): ?array;

    /**
     * Revive a soft-deleted note — restore .json from .deleted.json
     * and remove the tombstone.  Idempotent.
     */
    public function reviveNote(string $id): void;

    /** Hard-delete a single tombstone (no TTL check).  Idempotent. */
    public function hardDeleteNote(string $id): void;

    // ── Logged write operations ────────────────────────────────────────
    //
    // Each composes a CRUD operation + a changelog append in one call.
    // Backends that support transactions (MySQL) can do both atomically.

    /**
     * Apply a CREATE or UPDATE and write a changelog entry.
     * Returns [version_key, dirty_bit] or null if the client version is missing.
     */
    public function putNoteLogged(
        string $id, string $content, string $author,
        int $clientId, string $clientVersion
    ): ?array;

    /** Soft-delete a note and log to the changelog. */
    public function deleteNoteLogged(string $id, string $author): bool;

    /** Rename a live note and log to the changelog. */
    public function renameNoteLogged(string $oldId, string $newId, string $author): bool;

    // ── Sync helpers ───────────────────────────────────────────────────

    /**
     * Mark the current version as "seen" by a different client,
     * clearing its exclusive flag so the next save creates a new version.
     */
    public function markVersionSeen(string $id, int $clientId): void;

    // ── Version history ────────────────────────────────────────────────

    /** Return version metadata for all versions of a note, newest first. */
    public function getVersionList(string $id): array;

    /** Return content for a specific version, or null if not found. */
    public function getVersionContent(string $id, string $vkey): ?string;

    // ── Changelog ──────────────────────────────────────────────────────

    /** Append one entry to the changelog. */
    public function changelogAppend(array $entry): void;

    /** Return the next revision number (max rev + 1). */
    public function changelogNextRev(): int;

    /** Return all changelog entries with rev > $since, ascending. */
    public function changelogSince(int $since): array;

    /** Return the highest revision number in the changelog. */
    public function changelogCurrentRev(): int;

    /** Return the revision number of the oldest surviving changelog entry. */
    public function changelogEarliestRev(): int;

    // ── Housekeeping ───────────────────────────────────────────────────

    /**
     * Periodic housekeeping hook.  Entry points are backend-specific.
     * Called by the daily purge in sync.php.
     */
    public function housekeeping(string $entry): int;

    // ── Capabilities ───────────────────────────────────────────────────

    /** Whether this backend supports end-to-end encryption semantics. */
    public function e2eeSupport(): bool;
}
