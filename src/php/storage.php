<?php
/**
 * storage.php — storage accessor
 *
 * Provides a single access point to the storage backend.  The actual
 * implementation is set once during bootstrap (in config.php).
 *
 * Consumers (sync.php, trash.php, history.php) call storage()->method()
 * instead of the old storage_*() global functions.
 *
 * To swap backends, change the one line in config.php that calls
 * storage_set() — no other file needs to change.
 */

require_once __DIR__ . '/storage/StorageInterface.php';

/** @var StorageInterface|null */
$_storage = null;

/**
 * Set the storage backend instance.  Called once from config.php during
 * bootstrap, before any endpoint handlers run.
 */
function storage_set(StorageInterface $s): void
{
    global $_storage;
    $_storage = $s;
}

/**
 * Get the storage backend instance.
 *
 * @throws \RuntimeException if storage_set() has not been called
 */
function storage(): StorageInterface
{
    global $_storage;
    if (!$_storage) {
        throw new \RuntimeException(
            'Storage backend not initialised — call storage_set() during bootstrap'
        );
    }
    return $_storage;
}
