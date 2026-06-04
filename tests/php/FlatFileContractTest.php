<?php
use PHPUnit\Framework\Attributes\Test;

require_once __DIR__ . '/StorageContractTestBase.php';

/**
 * FlatFileContractTest — runs all contract tests against FlatFileStorage.
 *
 * Also includes two flat-file-specific tests that manipulate internal
 * version structures ($note['versions'], direct filesystem paths) which
 * don't apply to the git backend.
 */
class FlatFileContractTest extends StorageContractTestBase
{
    protected function createStorage(): void
    {
        @require_once LEAF_PHP_DIR . 'storage/FlatFileStorage.php';
        $s = new FlatFileStorage(DATA_ROOT, DELETED_NOTE_TTL_DAYS);
        $GLOBALS['testStorage'] = $s;
        storage_set($s);
    }

    // ═══════════════════════════════════════════════════════════════
    // Flat-file-specific tests (internal format manipulation)
    // ═══════════════════════════════════════════════════════════════

    /**
     * git-storage § "Commit Triggers" — Date change triggers flush
     *
     * Flat-file: simulates date change by rewriting the version key's
     * date component directly in the versions map.
     */
    #[Test]
    public function flatFile_dateChange_triggerFlushesOldStage(): void
    {
        // Alice writes today
        [$v_today] = storage()->putNoteLogged(
            'note', 'content today', 'alice', 1, 'local'
        );

        // Simulate date change: rewrite the version key to use yesterday's
        // date.  storage_resolve_version now extracts the date from the key,
        // so we must change the key, not just saved_at.
        $note = storage()->getNote('note');
        $yesterday = gmdate('Y-m-d', time() - 86400);
        $old_key = $v_today;
        $new_key = preg_replace('/^\d{4}-\d{2}-\d{2}/', $yesterday, $v_today);
        $note['versions'][$new_key] = $note['versions'][$old_key];
        unset($note['versions'][$old_key]);
        $note['current'] = $new_key;
        storage_invoke('putNote','note', $note);

        // Alice writes again today — key date differs → new version
        [$v_tomorrow] = storage()->putNoteLogged(
            'note', 'content tomorrow', 'alice', 1, $new_key
        );

        // Date changed → must create new version key
        $this->assertNotSame($new_key, $v_tomorrow,
            'Date change must create a new version, not overwrite');

        // Both versions exist
        $versions = storage()->getVersionList('note');
        $this->assertGreaterThanOrEqual(2, count($versions));
    }

    /**
     * git-storage § "Housekeeping / Staging TTL"
     *
     * Flat-file: backdates a tombstone .deleted.json file and verifies
     * housekeeping('sync') purges it.
     */
    #[Test]
    public function flatFile_housekeeping_purgesExpiredTombstones(): void
    {
        // Create and delete a note, then backdate the tombstone
        storage()->putNoteLogged('old', 'stale content', 'alice', 1, 'local');
        storage()->deleteNoteLogged('old', 'alice');

        // Backdate the tombstone to expire it
        $path = NOTES_DIR . 'old.deleted.json';
        $data = json_decode(file_get_contents($path), true);
        $data['deleted_at'] = time() - (DELETED_NOTE_TTL_DAYS + 1) * 86400;
        file_put_contents($path, json_encode($data));

        // housekeeping flushes expired entries
        $removed = storage()->housekeeping('sync');
        $this->assertSame(1, $removed,
            'Housekeeping must process expired items');
        $this->assertNull(storage()->getTombstone('old'),
            'Expired tombstone must be gone after housekeeping');

        // A recent tombstone survives
        storage()->putNoteLogged('recent', 'fresh content', 'bob', 2, 'local');
        storage()->deleteNoteLogged('recent', 'bob');
        $removed2 = storage()->housekeeping('sync');
        $this->assertSame(0, $removed2,
            'Recent tombstone must survive housekeeping');
        $this->assertNotNull(storage()->getTombstone('recent'));
    }
}
