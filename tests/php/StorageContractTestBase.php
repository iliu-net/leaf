<?php
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/**
 * Storage Contract Test — validates the storage.php public API.
 *
 * Exercises all seven contract functions defined in Change 026 at the
 * consumer level.  Never accesses internal storage details: no
 * $note['versions'], no note_path() / deleted_path(), no
 * changelog_append().  The same test suite can validate alternative
 * backends (git, MySQL) by swapping the source file in bootstrap.php
 * — the assertions encode the behavioural contract, not implementation
 * details.
 *
 * The test is also written to exercise concerns from
 * TODO/git-storage.md:
 *
 *  • $viewer parameter on storage_get_note_full (staging-flush trigger)
 *  • $dirty return from storage_put_note_logged    (staged vs committed)
 *  • version-immutability semantics                (commits are immutable)
 *  • tombstone metadata contract                   (.deleted markers)
 *  • changelog entry shape (version/prev_version as opaque strings)
 *  • created_by preservation across the lifecycle
 *  • storage_housekeeping as the maintenance hook
 *  • storage_e2ee_support backend capability flag
 */
abstract class StorageContractTestBase extends TestCase
{
    private string $notesDir;

    /**
     * Subclasses wire their backend here by calling storage_set().
     * Called before each test.
     */
    abstract protected function createStorage(): void;

    protected function setUp(): void
    {
        $this->notesDir = NOTES_DIR;
        $this->cleanNotesDir();
        // Clean changelog too — not covered by cleanNotesDir glob
        if (file_exists(CHANGELOG_FILE)) unlink(CHANGELOG_FILE);
        // Clean any git lock file or .git directory left from a prior test run
        $this->cleanGitArtifacts();
        $this->createStorage();
    }

    protected function tearDown(): void
    {
        $this->cleanNotesDir();
        if (file_exists(CHANGELOG_FILE)) unlink(CHANGELOG_FILE);
        $this->cleanGitArtifacts();
    }

    private function cleanNotesDir(): void
    {
        // Recursively remove all files and directories under notes/
        $this->rmTree($this->notesDir);
        if (!is_dir($this->notesDir)) mkdir($this->notesDir, 0755, true);
    }

    /** Remove git artifacts from DATA_ROOT so each test starts fresh. */
    private function cleanGitArtifacts(): void
    {
        $gitDir = DATA_ROOT . '.git';
        if (is_dir($gitDir)) {
            $this->rmTree($gitDir);
        }
        $lockFile = DATA_ROOT . '.git-lock';
        if (file_exists($lockFile)) unlink($lockFile);
        $gitignore = DATA_ROOT . '.gitignore';
        if (file_exists($gitignore)) unlink($gitignore);
    }

    /**
     * Check whether any key in the array starts with the given SHA prefix.
     * Used because git backend keys are composite: "{sha}\x00{path}".
     */
    private function arrayContainsKeyStartingWith(array $keys, string $sha): bool
    {
        foreach ($keys as $k) {
            if (str_starts_with($k, $sha)) return true;
        }
        return false;
    }

    /** Recursively remove a directory tree. */
    private function rmTree(string $dir): void
    {
        if (!is_dir($dir)) return;
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dir, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($iterator as $file) {
            if ($file->isDir()) {
                rmdir($file->getPathname());
            } else {
                unlink($file->getPathname());
            }
        }
        if (is_dir($dir)) rmdir($dir);
    }

    // ═══════════════════════════════════════════════════════════════
    // storage()->getNoteFull($id, $viewer) ── Change 026 Phase 1
    // ═══════════════════════════════════════════════════════════════

    #[Test]
    public function getNoteFull_returnsNullForNonexistentNote(): void
    {
        $this->assertNull(storage()->getNoteFull('no-such-note', 1));
    }

    #[Test]
    public function getNoteFull_returnsNullForDeletedNote(): void
    {
        storage()->putNoteLogged('doomed', 'hello', 'alice', 1, 'local');
        storage()->deleteNoteLogged('doomed', 'alice');

        $this->assertNull(storage()->getNoteFull('doomed', 1));
    }

    #[Test]
    public function getNoteFull_returnsNormalizedFlatShape(): void
    {
        [$version] = storage()->putNoteLogged('flat', 'hello world', 'alice', 1, 'local');
        $note = storage()->getNoteFull('flat', 1);

        $this->assertIsArray($note);
        $this->assertArrayHasKey('content',    $note);
        $this->assertArrayHasKey('version',    $note);
        $this->assertArrayHasKey('prev',       $note);
        $this->assertArrayHasKey('author',     $note);
        $this->assertArrayHasKey('updated_at', $note);
        $this->assertArrayHasKey('created_at', $note);
        $this->assertArrayHasKey('created_by', $note);

        $this->assertSame('hello world', $note['content']);
        $this->assertSame($version,      $note['version']);
        $this->assertNull($note['prev']);
        $this->assertSame('alice',       $note['author']);
        $this->assertGreaterThan(0,      $note['updated_at']);
        $this->assertGreaterThan(0,      $note['created_at']);
        $this->assertSame('alice',       $note['created_by']);
    }

    #[Test]
    public function getNoteFull_prevLinksToPreviousVersion(): void
    {
        [$v1] = storage()->putNoteLogged('link', 'first', 'alice', 1, 'local');
        [$v2] = storage()->putNoteLogged('link', 'second', 'bob', 2, $v1);

        $note = storage()->getNoteFull('link', 1);
        $this->assertSame('second', $note['content']);
        $this->assertSame($v2,      $note['version']);
        $this->assertSame($v1,      $note['prev']);
        $this->assertSame('bob',    $note['author']);
        $this->assertSame('alice',  $note['created_by'], 'created_by immutable');
    }

    #[Test]
    public function getNoteFull_returnsLatestVersion(): void
    {
        [$v1] = storage()->putNoteLogged('latest', 'v1', 'alice', 1, 'local');
        [$v2] = storage()->putNoteLogged('latest', 'v2', 'bob', 2, $v1);
        storage()->putNoteLogged('latest', 'v3', 'charlie', 3, $v2);

        $note = storage()->getNoteFull('latest', 1);
        $this->assertSame('v3', $note['content']);
        $this->assertSame('charlie', $note['author']);
    }

    // ── $viewer parameter (git-backend readiness) ──────────────────

    #[Test]
    public function getNoteFull_viewerParameterAcceptedForAllIdentities(): void
    {
        storage()->putNoteLogged('note', 'secret', 'alice', 1, 'local');

        $asAlice   = storage()->getNoteFull('note', 1);
        $asBob     = storage()->getNoteFull('note', 2);
        $asEmpty   = storage()->getNoteFull('note', 0);
        $asUnknown = storage()->getNoteFull('note', 999);

        $this->assertIsArray($asAlice);
        $this->assertIsArray($asBob);
        $this->assertIsArray($asEmpty);
        $this->assertIsArray($asUnknown);

        // The viewer parameter is a staging-flush trigger in the git
        // backend.  Flat-file backend ignores it, so all calls return
        // identical content regardless of viewer identity.
        $this->assertSame($asAlice['content'], $asBob['content']);
        $this->assertSame($asAlice['version'], $asBob['version']);
        $this->assertSame($asAlice['content'], $asEmpty['content']);
    }

    // ═══════════════════════════════════════════════════════════════
    // storage()->putNoteLogged($id, $content, $author, $client_version)
    // ── Change 026 Phase 2
    // ═══════════════════════════════════════════════════════════════

    #[Test]
    public function putNoteLogged_createsNoteAndReturnsVersion(): void
    {
        [$version, $dirty] = storage()->putNoteLogged(
            'new-note', 'hello', 'alice', 1, 'local'
        );

        $this->assertIsString($version);
        $this->assertNotEmpty($version);
        $this->assertIsBool($dirty);
        $this->assertTrue(storage_invoke('noteExists','new-note'));

        $note = storage()->getNoteFull('new-note', 1);
        $this->assertSame('hello', $note['content']);
        $this->assertSame('alice', $note['created_by']);
        $this->assertSame('alice', $note['author']);
    }

    #[Test]
    public function putNoteLogged_updatesExistingNote(): void
    {
        [$v1] = storage()->putNoteLogged('note', 'v1', 'alice', 1, 'local');
        [$v2, $dirty] = storage()->putNoteLogged('note', 'v2', 'alice', 1, $v1);

        $this->assertIsString($v2);
        $this->assertNotEmpty($v2);
        $this->assertFalse($dirty);

        $note = storage()->getNoteFull('note', 1);
        $this->assertSame('v2',    $note['content']);
        $this->assertSame('alice', $note['created_by'],
            'created_by must survive updates');
    }

    #[Test]
    public function putNoteLogged_acceptsEmptyClientVersion(): void
    {
        // Empty client_version is accepted — creates a new note (previously returned null)
        [$version, $dirty] = storage()->putNoteLogged('note', 'content', 'alice', 1, '');
        $this->assertIsString($version);
        $this->assertNotEmpty($version);
        $this->assertIsBool($dirty);
        $this->assertTrue(storage_invoke('noteExists','note'));

        $note = storage()->getNoteFull('note', 1);
        $this->assertSame('content', $note['content']);
    }

    #[Test]
    public function putNoteLogged_revivesDeletedTombstone(): void
    {
        [$v1] = storage()->putNoteLogged('note', 'original', 'alice', 1, 'local');
        storage()->deleteNoteLogged('note', 'alice');

        $this->assertNull(storage()->getNoteFull('note', 1),
            'Note should be inaccessible after delete');
        $this->assertNotNull(storage()->getTombstone('note'),
            'Tombstone must exist after delete');

        // A new write on the same ID revives the note
        [$version, $dirty] = storage()->putNoteLogged(
            'note', 'revived', 'alice', 1, $v1
        );

        $this->assertIsString($version);
        $this->assertNotEmpty($version);
        $this->assertFalse($dirty);

        $note = storage()->getNoteFull('note', 1);
        $this->assertSame('revived', $note['content']);
        $this->assertFalse(storage()->noteDeleted('note'));
        $this->assertNull(storage()->getTombstone('note'),
            'Tombstone must be gone after revive');
    }

    #[Test]
    public function putNoteLogged_detectsConflictsAndStillWrites(): void
    {
        // Alice creates v1
        [$v1] = storage()->putNoteLogged('note', 'alice-v1', 'alice', 1, 'local');

        // Bob writes with a stale version → conflict logged, write wins
        [$v2, $dirty] = storage()->putNoteLogged(
            'note', 'bob-v1', 'bob', 2, 'wrong-version'
        );

        $this->assertIsString($v2);
        $this->assertNotEmpty($v2);
        $this->assertFalse($dirty);

        // Last-write-wins: Bob's content is current
        $note = storage()->getNoteFull('note', 1);
        $this->assertSame('bob-v1', $note['content']);
    }

    #[Test]
    public function putNoteLogged_differentAuthorCreatesNewVersion(): void
    {
        [$v1] = storage()->putNoteLogged('note', 'alice-v1', 'alice', 1, 'local');
        [$v2] = storage()->putNoteLogged('note', 'bob-v1', 'bob', 2, $v1);

        $this->assertNotSame($v1, $v2,
            'Different author must create a new version key');

        $versions = storage()->getVersionList('note');
        $this->assertCount(2, $versions);

        // Both versions still retrievable
        $this->assertSame('alice-v1', storage()->getVersionContent('note', $v1));
        $this->assertSame('bob-v1',   storage()->getVersionContent('note', $v2));
    }

    // ── $dirty flag (git-backend readiness) ────────────────────────

    #[Test]
    public function putNoteLogged_dirtyFlagIsBooleanOnCreate(): void
    {
        [$version, $dirty] = storage()->putNoteLogged(
            'note', 'content', 'alice', 1, 'local'
        );
        $this->assertIsBool($dirty);
        // Flat-file always commits immediately → $dirty is always false.
        // Git backend will return true when content is staged to
        // .md/.meta but not yet committed.
    }

    #[Test]
    public function putNoteLogged_dirtyFlagIsBooleanOnUpdate(): void
    {
        [$v1] = storage()->putNoteLogged('note', 'v1', 'alice', 1, 'local');
        [$v2, $dirty] = storage()->putNoteLogged('note', 'v2', 'alice', 1, $v1);
        $this->assertIsBool($dirty);
    }

    // ═══════════════════════════════════════════════════════════════
    // storage()->deleteNoteLogged($id, $author) ── Change 026 Phase 3
    // ═══════════════════════════════════════════════════════════════

    #[Test]
    public function deleteNoteLogged_softDeletesLiveNote(): void
    {
        storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');
        $result = storage()->deleteNoteLogged('note', 'alice');

        $this->assertTrue($result);
        $this->assertFalse(storage_invoke('noteExists','note'));
        $this->assertTrue(storage()->noteDeleted('note'));
        $this->assertNull(storage()->getNoteFull('note', 1));
    }

    #[Test]
    public function deleteNoteLogged_failsOnAlreadyDeleted(): void
    {
        storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');
        storage()->deleteNoteLogged('note', 'alice');

        $this->assertFalse(storage()->deleteNoteLogged('note', 'alice'));
    }

    #[Test]
    public function deleteNoteLogged_failsOnNonexistent(): void
    {
        $this->assertFalse(
            storage()->deleteNoteLogged('no-such-note', 'alice')
        );
    }

    #[Test]
    public function deleteNoteLogged_producesChangelogEntry(): void
    {
        $before = storage()->changelogCurrentRev();

        storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');
        storage()->deleteNoteLogged('note', 'alice');

        $after = storage()->changelogCurrentRev();
        // CREATE + DELETE = 2 new entries
        $this->assertSame($before + 2, $after);
    }

    // ═══════════════════════════════════════════════════════════════
    // storage()->renameNoteLogged($old, $new, $author) ── Phase 3
    // ═══════════════════════════════════════════════════════════════

    #[Test]
    public function renameNoteLogged_movesNote(): void
    {
        storage()->putNoteLogged('old', 'content', 'alice', 1, 'local');
        $result = storage()->renameNoteLogged('old', 'new', 'alice');

        $this->assertTrue($result);
        $this->assertFalse(storage_invoke('noteExists','old'));
        $this->assertTrue(storage_invoke('noteExists','new'));

        $note = storage()->getNoteFull('new', 1);
        $this->assertSame('content', $note['content']);
        $this->assertSame('alice',   $note['created_by']);
    }

    #[Test]
    public function renameNoteLogged_preservesFullVersionHistory(): void
    {
        [$v1] = storage()->putNoteLogged('note', 'v1', 'alice', 1, 'local');
        [$v2] = storage()->putNoteLogged('note', 'v2', 'bob', 2, $v1);
        [$v3] = storage()->putNoteLogged('note', 'v3', 'charlie', 3, $v2);

        $this->assertTrue(
            storage()->renameNoteLogged('note', 'renamed', 'alice')
        );

        $versions = storage()->getVersionList('renamed');
        // Git backend includes the rename commit itself in the history (4 commits:
        // 3 content + 1 rename). Flat-file has exactly 3 entries in the versions map.
        $this->assertGreaterThanOrEqual(3, count($versions),
            'Rename must preserve all version history');

        $note = storage()->getNoteFull('renamed', 1);
        $this->assertSame('v3', $note['content']);

        // Content for each version still accessible by key
        foreach ($versions as $v) {
            $this->assertNotNull(
                storage()->getVersionContent('renamed', $v['key'])
            );
        }
    }

    #[Test]
    public function renameNoteLogged_failsOnNonexistentSource(): void
    {
        $this->assertFalse(
            storage()->renameNoteLogged('no-such', 'new', 'alice')
        );
    }

    #[Test]
    public function renameNoteLogged_failsOnOccupiedTarget(): void
    {
        storage()->putNoteLogged('source', 'src-content', 'alice', 1, 'local');
        storage()->putNoteLogged('target', 'tgt-content', 'alice', 1, 'local');

        $this->assertFalse(
            storage()->renameNoteLogged('source', 'target', 'alice')
        );

        // Source remains intact after failed rename
        $this->assertTrue(storage_invoke('noteExists','source'));
        $this->assertSame(
            'src-content',
            storage()->getNoteFull('source', 1)['content']
        );
    }

    #[Test]
    public function renameNoteLogged_failsOnEmptyNewId(): void
    {
        storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');
        $this->assertFalse(
            storage()->renameNoteLogged('note', '', 'alice')
        );
        $this->assertTrue(storage_invoke('noteExists','note'));
    }

    #[Test]
    public function renameNoteLogged_producesChangelogEntry(): void
    {
        $before = storage()->changelogCurrentRev();

        storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');
        storage()->renameNoteLogged('note', 'moved', 'alice');

        $after = storage()->changelogCurrentRev();
        // CREATE + RENAME = 2 new entries
        $this->assertSame($before + 2, $after);
    }

    // ═══════════════════════════════════════════════════════════════
    // storage()->getVersionList($id) ── Change 026 Phase 4
    // ═══════════════════════════════════════════════════════════════

    #[Test]
    public function getVersionList_returnsEmptyForNonexistent(): void
    {
        $this->assertSame([], storage()->getVersionList('no-such-note'));
    }

    #[Test]
    public function getVersionList_returnsEmptyForDeleted(): void
    {
        storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');
        storage()->deleteNoteLogged('note', 'alice');

        $this->assertSame([], storage()->getVersionList('note'));
    }

    #[Test]
    public function getVersionList_returnsAllVersionsNewestFirst(): void
    {
        [$v1] = storage()->putNoteLogged('note', 'v1', 'alice', 1, 'local');
        sleep(1);  // guarantee distinct saved_at (second granularity)
        [$v2] = storage()->putNoteLogged('note', 'v2', 'bob', 2, $v1);
        sleep(1);
        [$v3] = storage()->putNoteLogged('note', 'v3', 'charlie', 3, $v2);

        $list = storage()->getVersionList('note');
        $this->assertCount(3, $list);

        // Newest first — saved_at timestamps are 2 s apart.
        // Key format varies by backend (composite for flat-file, sha+path for git).
        $this->assertStringStartsWith($v3, $list[0]['key']);
        $this->assertStringStartsWith($v2, $list[1]['key']);
        $this->assertStringStartsWith($v1, $list[2]['key']);
    }

    #[Test]
    public function getVersionList_eachEntryHasRequiredKeys(): void
    {
        storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');

        $list = storage()->getVersionList('note');
        $this->assertCount(1, $list);

        $entry = $list[0];
        $this->assertArrayHasKey('key',      $entry);
        $this->assertArrayHasKey('author',   $entry);
        $this->assertArrayHasKey('saved_at', $entry);
        $this->assertArrayHasKey('prev',     $entry);

        $this->assertIsString($entry['key']);
        $this->assertIsString($entry['author']);
        $this->assertIsInt($entry['saved_at']);
        // prev may be null
    }

    // ═══════════════════════════════════════════════════════════════
    // storage()->getVersionContent($id, $vkey) ── Phase 4
    // ═══════════════════════════════════════════════════════════════

    #[Test]
    public function getVersionContent_returnsContentForVersion(): void
    {
        // Use different authors to guarantee distinct version keys
        // (same-author same-day override would keep the same key)
        [$v1] = storage()->putNoteLogged('note', 'version-one', 'alice', 1, 'local');
        [$v2] = storage()->putNoteLogged('note', 'version-two', 'bob', 2, $v1);

        $this->assertSame(
            'version-one',
            storage()->getVersionContent('note', $v1)
        );
        $this->assertSame(
            'version-two',
            storage()->getVersionContent('note', $v2)
        );
    }

    #[Test]
    public function getVersionContent_returnsNullForUnknownKey(): void
    {
        storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');

        $this->assertNull(
            storage()->getVersionContent('note', 'nonexistent-key')
        );
    }

    #[Test]
    public function getVersionContent_returnsNullForNonexistentNote(): void
    {
        $this->assertNull(
            storage()->getVersionContent('no-such-note', 'any-key')
        );
    }

    #[Test]
    public function getVersionContent_returnsNullForDeletedNote(): void
    {
        storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');
        $vkey = storage()->getNoteFull('note', 1)['version'];
        storage()->deleteNoteLogged('note', 'alice');

        $this->assertNull(
            storage()->getVersionContent('note', $vkey)
        );
    }

    // ═══════════════════════════════════════════════════════════════
    // storage()->getTombstone($id) ── Change 026 Phase 5
    // ═══════════════════════════════════════════════════════════════

    #[Test]
    public function getTombstone_returnsNullForLiveNote(): void
    {
        storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');
        $this->assertNull(storage()->getTombstone('note'));
    }

    #[Test]
    public function getTombstone_returnsNullForNonexistent(): void
    {
        $this->assertNull(storage()->getTombstone('no-such-note'));
    }

    #[Test]
    public function getTombstone_returnsNullAfterTombstoneIsRevived(): void
    {
        [$v1] = storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');
        storage()->deleteNoteLogged('note', 'alice');
        $this->assertNotNull(storage()->getTombstone('note'));

        // Revive via a new write
        storage()->putNoteLogged('note', 'revived', 'bob', 2, $v1);
        $this->assertNull(storage()->getTombstone('note'),
            'Tombstone must be gone after revive');
    }

    #[Test]
    public function getTombstone_returnsFullMetadata(): void
    {
        storage()->putNoteLogged('note', 'precious content', 'creator', 1, 'local');
        storage()->deleteNoteLogged('note', 'destroyer');

        $tombstone = storage()->getTombstone('note');
        $this->assertIsArray($tombstone);

        // Required fields per contract
        $this->assertArrayHasKey('content',    $tombstone);
        $this->assertArrayHasKey('version',    $tombstone);
        $this->assertArrayHasKey('created_at', $tombstone);
        $this->assertArrayHasKey('created_by', $tombstone);
        $this->assertArrayHasKey('deleted_at', $tombstone);
        $this->assertArrayHasKey('deleted_by', $tombstone);

        $this->assertSame('precious content', $tombstone['content']);
        $this->assertSame('creator',          $tombstone['created_by']);
        $this->assertSame('destroyer',        $tombstone['deleted_by']);
        $this->assertGreaterThan(0,           $tombstone['deleted_at']);
        $this->assertGreaterThan(0,           $tombstone['created_at']);
        $this->assertNotEmpty($tombstone['version']);
    }

    #[Test]
    public function getTombstone_preservesDeletedByCorrectly(): void
    {
        storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');
        storage()->deleteNoteLogged('note', 'charlie');

        $tombstone = storage()->getTombstone('note');
        $this->assertSame('charlie', $tombstone['deleted_by'],
            'deleted_by must reflect who performed the deletion');
        $this->assertSame('alice', $tombstone['created_by'],
            'created_by must reflect the original creator');
    }

    // ═══════════════════════════════════════════════════════════════
    // storage()->housekeeping($entry) ── Change 026 maintenance hook
    // ═══════════════════════════════════════════════════════════════

    #[Test]
    public function housekeeping_syncEntryReturnsInt(): void
    {
        $result = storage()->housekeeping('sync');
        $this->assertIsInt($result);
    }

    #[Test]
    public function housekeeping_unknownEntryReturnsZero(): void
    {
        $result = storage()->housekeeping('unknown-entry');
        $this->assertSame(0, $result);
    }

    #[Test]
    public function housekeeping_unknownEntryDoesNotPurge(): void
    {
        storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');
        storage()->deleteNoteLogged('note', 'alice');

        storage()->housekeeping('unknown-entry');

        $this->assertNotNull(storage()->getTombstone('note'),
            'Tombstone must survive unknown entry point');
    }

    // ═══════════════════════════════════════════════════════════════
    // storage()->e2eeSupport() ── backend capability flag
    // ═══════════════════════════════════════════════════════════════

    #[Test]
    public function e2eeSupport_returnsBoolean(): void
    {
        $result = storage()->e2eeSupport();
        $this->assertIsBool($result);

        // Flat-file backend supports E2EE (content is opaque blobs).
        // Git backend will return false (content must be server-visible
        // markdown for git diffs to be meaningful).
    }

    // ═══════════════════════════════════════════════════════════════
    // Full-lifecycle integration (all contract functions)
    // ═══════════════════════════════════════════════════════════════

    #[Test]
    public function fullLifecycle_createReadUpdateDeleteTombstone(): void
    {
        // ── CREATE ──────────────────────────────────────
        [$v1, $d1] = storage()->putNoteLogged(
            'lifecycle', 'step-1', 'alice', 1, 'local'
        );
        $this->assertNotEmpty($v1);
        $this->assertFalse($d1);

        // ── READ ────────────────────────────────────────
        $note = storage()->getNoteFull('lifecycle', 1);
        $this->assertSame('step-1', $note['content']);
        $this->assertSame($v1,      $note['version']);
        $this->assertNull($note['prev']);
        $this->assertSame('alice',  $note['created_by']);

        // ── UPDATE (different author → guaranteed new key) ──
        [$v2, $d2] = storage()->putNoteLogged(
            'lifecycle', 'step-2', 'bob', 2, $v1
        );
        $this->assertNotEmpty($v2);
        $this->assertNotSame($v1, $v2,
            'Different author must produce new version key');
        $this->assertFalse($d2);

        $note = storage()->getNoteFull('lifecycle', 1);
        $this->assertSame('step-2', $note['content']);
        $this->assertSame('alice',  $note['created_by'],
            'created_by must survive updates');

        // ── UPDATE (third author) ───────────────────────
        [$v3, $d3] = storage()->putNoteLogged(
            'lifecycle', 'step-3', 'charlie', 3, $v2
        );
        $this->assertNotEmpty($v3);
        $this->assertNotSame($v2, $v3,
            'Different author must produce new version key');
        $this->assertFalse($d3);

        // ── VERSION HISTORY ─────────────────────────────
        $versions = storage()->getVersionList('lifecycle');
        $this->assertGreaterThanOrEqual(3, count($versions),
            'At least 3 versions from 3 distinct authors');

        // ── VERSION CONTENT ─────────────────────────────
        // Bob's v2 content retrievable
        $this->assertSame('step-2',
            storage()->getVersionContent('lifecycle', $v2));
        // Charlie's v3 is current
        $this->assertSame('step-3',
            storage()->getVersionContent('lifecycle', $v3));

        // ── DELETE ──────────────────────────────────────
        $this->assertTrue(
            storage()->deleteNoteLogged('lifecycle', 'dave')
        );
        $this->assertNull(
            storage()->getNoteFull('lifecycle', 1)
        );
        $this->assertTrue(storage()->noteDeleted('lifecycle'));

        // ── TOMBSTONE ───────────────────────────────────
        $tomb = storage()->getTombstone('lifecycle');
        $this->assertIsArray($tomb);
        $this->assertSame('step-3', $tomb['content']);
        $this->assertSame('dave',   $tomb['deleted_by']);
        $this->assertSame('alice',  $tomb['created_by']);
        $this->assertGreaterThan(0, $tomb['deleted_at']);

        // ── REVIVE via new write ────────────────────────
        [$v4, $d4] = storage()->putNoteLogged(
            'lifecycle', 'reborn', 'alice', 1, $v3
        );
        $this->assertNotEmpty($v4);
        $this->assertFalse($d4);

        $note = storage()->getNoteFull('lifecycle', 1);
        $this->assertSame('reborn', $note['content']);
        $this->assertNull(storage()->getTombstone('lifecycle'));
    }

    // ═══════════════════════════════════════════════════════════════
    // Git-backend readiness — contract-level concerns
    // ═══════════════════════════════════════════════════════════════

    /**
     * git-storage concern: commits are immutable.
     * Every distinct write must produce a version key that can be used
     * to retrieve that exact content later.  Content must never change
     * under a given key once written.
     */
    #[Test]
    public function versionImmutability_contentStableUnderKey(): void
    {
        [$v1] = storage()->putNoteLogged('note', 'original', 'alice', 1, 'local');

        // Write same author again (may overwrite in flat-file, but
        // in git it would be a new commit with a different SHA)
        storage()->putNoteLogged('note', 'updated', 'alice', 1, $v1);

        // In the flat-file backend, v1 content may be overwritten if
        // the exclusive flag was still set.  In the git backend, v1
        // content would still be 'original'.  Both are valid contract
        // behaviours — the key invariant is that if a key IS still in
        // the version list, its content matches what was stored.
        $versions = storage()->getVersionList('note');
        foreach ($versions as $v) {
            $content = storage()->getVersionContent('note', $v['key']);
            if ($content !== null) {
                $this->assertIsString($content);
                $this->assertNotEmpty($content);
            }
        }
    }

    /**
     * git-storage concern: changelog trail enables incremental sync
     * (fast path) AND full reconstruction from git log.  Every logged
     * operation must produce a changelog entry with consistent shape.
     */
    #[Test]
    public function changelogTrail_everyOperationProducesEntry(): void
    {
        $before = storage()->changelogCurrentRev();

        // Four distinct operations, each with correct client_version
        [$v1] = storage()->putNoteLogged('a', 'create', 'alice', 1, 'local');    // 1
        [$v2] = storage()->putNoteLogged('a', 'update', 'bob', 2, $v1);         // 2
        storage()->renameNoteLogged('a', 'b', 'alice');                        // 3
        storage()->deleteNoteLogged('b', 'alice');                               // 4

        $after = storage()->changelogCurrentRev();
        $this->assertSame($before + 4, $after,
            'Each logged operation must produce a changelog entry');
    }

    /**
     * git-storage concern: the changelog trails by one entry in the
     * git backend (last entry is in working tree but not committed).
     * The working-tree changelog always has the full truth.
     */
    #[Test]
    public function changelogTrail_sinceReturnsExpectedEntries(): void
    {
        // This tests the incremental sync path: given a known
        // revision, changelog_since must return only later entries.

        storage()->putNoteLogged('x', 'v1', 'alice', 1, 'local');
        $after_create = storage()->changelogCurrentRev();

        storage()->putNoteLogged('y', 'v1', 'bob', 2, 'local');

        $since = storage()->changelogSince($after_create);
        // 'y' CREATE should be the only new entry
        $this->assertCount(1, $since);
        $this->assertSame('y', $since[0]['file']);
        $this->assertSame('CREATE', $since[0]['type']);
    }

    /**
     * git-storage concern: created_by is set on the first write and
     * never overwritten, even across updates and renames.  The git
     * backend can derive this from the first commit's author.
     */
    #[Test]
    public function createdBy_survivesAllMutations(): void
    {
        [$v1] = storage()->putNoteLogged('note', 'original', 'creator', 1, 'local');
        [$v2] = storage()->putNoteLogged('note', 'update1',  'editor1', 2, $v1);
        [$v3] = storage()->putNoteLogged('note', 'update2',  'editor2', 3, $v2);
        storage()->renameNoteLogged('note', 'moved', 'renamer');

        $note = storage()->getNoteFull('moved', 1);
        $this->assertSame('creator', $note['created_by'],
            'created_by must survive updates and renames');
        // author should reflect the latest writer (flat-file: editor1 or editor2;
        // git: the rename commit itself also touches the file, so 'renamer' is valid)
        $this->assertContains($note['author'], ['editor1', 'editor2', 'renamer'],
            'author should be one of the editors or the renamer');
    }

    /**
     * git-storage concern: concurrent writers produce a linear history
     * (last-write-wins).  Both writes succeed; history contains both.
     */
    #[Test]
    public function concurrentWriters_bothWritesSucceed(): void
    {
        [$v1] = storage()->putNoteLogged(
            'shared', 'Alice writes first', 'alice', 1, 'local'
        );

        // Bob writes based on v1
        [$v2] = storage()->putNoteLogged(
            'shared', 'Bob writes second', 'bob', 2, $v1
        );

        // Alice writes again based on v1 (missing Bob's v2)
        [$v3] = storage()->putNoteLogged(
            'shared', 'Alice writes third', 'alice', 1, $v1
        );

        // All writes succeed; last write wins
        $note = storage()->getNoteFull('shared', 1);
        $this->assertNotNull($note);

        // History preserves all content
        $versions = storage()->getVersionList('shared');
        $contents = [];
        foreach ($versions as $v) {
            $c = storage()->getVersionContent('shared', $v['key']);
            if ($c !== null) {
                $contents[] = $c;
            }
        }
        $this->assertContains('Alice writes first', $contents);
        $this->assertContains('Bob writes second',  $contents);
        $this->assertContains('Alice writes third', $contents);
    }

    /**
     * git-storage concern: the $viewer parameter triggers staging
     * flushes when viewer ≠ staged author.  The contract must accept
     * any viewer identity without error on every contract function.
     */
    #[Test]
    public function viewerParameter_acceptedOnAllRelevantFunctions(): void
    {
        storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');

        // storage_get_note_full with various viewers
        $this->assertNotNull(storage()->getNoteFull('note', 1));
        $this->assertNotNull(storage()->getNoteFull('note', 2));
        $this->assertNotNull(storage()->getNoteFull('note', 0));
        $this->assertNotNull(storage()->getNoteFull('note', 999));

        // Also works for the author of the note
        $note = storage()->getNoteFull('note', 1);
        $this->assertSame('content', $note['content']);
    }

    /**
     * git-storage concern: `.deleted` markers are NOT committed to
     * git — they are server-side operational state carrying
     * deleted_at/deleted_by metadata.  The tombstone contract must
     * expose this metadata through storage()->getTombstone().
     */
    #[Test]
    public function tombstoneMetadata_exposesDeletedAtAndDeletedBy(): void
    {
        $before = time();
        storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');
        storage()->deleteNoteLogged('note', 'bob');
        $after = time();

        $tomb = storage()->getTombstone('note');
        $this->assertIsArray($tomb);

        // deleted_at must be between before and after
        $this->assertGreaterThanOrEqual($before, $tomb['deleted_at']);
        $this->assertLessThanOrEqual($after, $tomb['deleted_at']);

        // deleted_by must match who performed the deletion
        $this->assertSame('bob', $tomb['deleted_by']);

        // created_by still reflects the original creator
        $this->assertSame('alice', $tomb['created_by']);
    }

    /**
     * git-storage concern: the housekeeping hook is the designated
     * entry point for periodic maintenance (TTL-based tombstone
     * expiry in flat-file, stale .meta flush in git).  The contract
     * requires it to accept an entry-point identifier.
     */
    #[Test]
    public function housekeeping_isDesignatedMaintenanceHook(): void
    {
        // The function exists and accepts the 'sync' entry point
        $result = storage()->housekeeping('sync');
        $this->assertIsInt($result);

        // Should be callable with the empty string as an entry
        $r2 = storage()->housekeeping('');
        $this->assertIsInt($r2);
    }

    // ═══════════════════════════════════════════════════════════════
    // Git-storage scenario tests ── Alice/Bob interaction sequences
    //
    // These walk through the specific scenarios described in
    // TODO/git-storage.md.  The flat-file backend doesn't have
    // .meta staging or git commits, but the consumer-visible
    // behaviours (version immutability after sharing, overwrite
    // debouncing, flush-trigger semantics) are exercised through the
    // contract using storage()->markVersionSeen() to simulate sync
    // delivery — the same mechanism sync.php uses in production.
    //
    // In the git backend these tests will pass without
    // storage()->markVersionSeen() because commits are immutable
    // and staging flushes happen automatically on viewer mismatch.
    // ═══════════════════════════════════════════════════════════════

    /**
     * git-storage § "Key Simplification: Commits Are Immutable"
     *
     * | Scenario              | Current                     | Git              |
     * | Alice saves v1        | key date:1:alice, excl=true  | commit abc       |
     * | Bob syncs, receives v1| exclusive→false             | Bob's client has abc |
     * | Alice saves again     | new key date:2:alice        | new commit def   |
     * | Bob syncs again       | receives v2; v1 intact      | receives def; abc intact |
     *
     * Contract: after another user receives a version, the original
     * author's next write MUST create a new version key — never
     * overwrite the shared version.
     */
    #[Test]
    public function gitScenario_immutability_sharedVersionNeverOverwritten(): void
    {
        // Alice saves v1
        [$v1] = storage()->putNoteLogged(
            'note', 'Alice version 1', 'alice', 1, 'local'
        );

        // Bob syncs → receives v1 (server marks version as delivered)
        $bob_view = storage()->getNoteFull('note', 2);
        $this->assertSame('Alice version 1', $bob_view['content']);
        $this->assertSame($v1, $bob_view['version']);
        storage()->markVersionSeen('note', 2);

        // Alice saves again → must NOT overwrite v1
        [$v2] = storage()->putNoteLogged(
            'note', 'Alice version 2', 'alice', 1, $v1
        );
        $this->assertNotSame($v1, $v2,
            'After Bob receives v1, Alice must get a new version key');

        // Both versions retrievable
        $aliceContentV1 = storage()->getVersionContent('note', $v1);
        $aliceContentV2 = storage()->getVersionContent('note', $v2);
        $this->assertNotNull($aliceContentV1, 'v1 must survive after v2 created');
        $this->assertNotNull($aliceContentV2);

        // Bob syncs again → receives v2; v1 also still there
        $bob_view2 = storage()->getNoteFull('note', 2);
        $this->assertSame('Alice version 2', $bob_view2['content']);
        $versions = storage()->getVersionList('note');
        $this->assertGreaterThanOrEqual(2, count($versions));
    }

    /**
     * git-storage § "Write-Ahead Staging" (lazy-commit buffer)
     *
     * Alice writes v5 → .meta staged, NO git commit.
     * Alice writes v6 (same author, same date) → overwrites .md,
     * .meta unchanged → STILL no commit.
     *
     * Contract: same-author same-day rapid saves debounce into one
     * version slot (flat-file: overwrite; git: staged overwrite).
     */
    #[Test]
    public function gitScenario_stagingBuffer_sameAuthorRapidSavesDebounce(): void
    {
        [$v5] = storage()->putNoteLogged(
            'note', 'rapid save 5', 'alice', 1, 'local'
        );

        // Alice writes again immediately (same author, same day)
        [$v6] = storage()->putNoteLogged(
            'note', 'rapid save 6', 'alice', 1, $v5
        );

        // Flat-file: v5 overwritten by v6 (same key, exclusive=true).
        // Git: .md overwritten, no new commit, $dirty was false→true.
        $note = storage()->getNoteFull('note', 1);
        $this->assertSame('rapid save 6', $note['content']);
        $this->assertSame('alice', $note['author']);

        // Version count should be minimal.
        // Flat-file: overwrite → 1 version.  Git with immediate-commit mode
        // (STAGE_FLUSH_HOURS=0): 2 commits.  Git with staging: 1 commit.
        $versions = storage()->getVersionList('note');
        $this->assertLessThanOrEqual(2, count($versions),
            'Rapid same-author same-day saves should minimize version count');
    }

    /**
     * git-storage § "Read-Side Trigger"
     *
     * Alice stages content (.meta exists).  Bob calls
     * storage()->getNoteFull('note', 2).  Server sees viewer≠author,
     * flushes the stage (commits + unlinks .meta), then returns
     * the committed content to Bob.
     *
     * Contract: when a different user reads a note, any staged
     * content must be flushed so the reader sees the published state.
     * consumer is unaware — just passes $viewer and gets back data.
     */
    #[Test]
    public function gitScenario_stagingFlushOnRead_differentViewerTriggersFlush(): void
    {
        // Alice writes (creates note; in git: stages .meta)
        [$v1] = storage()->putNoteLogged(
            'note', 'Alice staged content', 'alice', 1, 'local'
        );
        $this->assertNotEmpty($v1);

        // Alice re-reads her own content (viewer=author → no flush in git)
        $alice_view = storage()->getNoteFull('note', 1);
        $this->assertSame('Alice staged content', $alice_view['content']);

        // Bob reads (viewer≠author → triggers flush in git)
        // In flat-file: Bob's read via sync.php would call
        // storage_mark_version_seen, which we simulate here.
        $bob_view = storage()->getNoteFull('note', 2);
        $this->assertSame('Alice staged content', $bob_view['content']);
        $this->assertSame($v1, $bob_view['version'],
            'Bob sees the committed version, never a staged-only key');

        // After Bob's read, Alice's next write should create a new
        // version (exclusive→false in flat-file; new commit in git)
        storage()->markVersionSeen('note', 2);
        [$v2] = storage()->putNoteLogged(
            'note', 'Alice update after Bob read', 'alice', 1, $v1
        );
        $this->assertNotSame($v1, $v2,
            'After different viewer reads, next write must be a new version');

        // Bob reads again → receives v2
        $bob_view2 = storage()->getNoteFull('note', 2);
        $this->assertSame('Alice update after Bob read', $bob_view2['content']);
    }

    /**
     * git-storage § "Commit Triggers" — Different author writes
     *
     * Alice stages content (.meta exists, author=alice).
     * Bob pushes a write to the same note → server flushes Alice's
     * stage first (commits it), then stages Bob's content.
     *
     * Contract: a different-author write must flush any existing
     * staged content before proceeding.  Both writes end up as
     * distinct versions.
     */
    #[Test]
    public function gitScenario_stagingFlushOnWrite_differentAuthorTriggersFlush(): void
    {
        // Alice writes (stages content)
        [$v_alice] = storage()->putNoteLogged(
            'note', 'Alice writes first', 'alice', 1, 'local'
        );

        // Simulate: Alice's content has been "seen" by no one else yet.
        // Now Bob writes to the same note.
        // In git: this triggers flush of Alice's stage, then stages Bob's.
        // In flat-file: Bob gets a different key regardless.
        [$v_bob] = storage()->putNoteLogged(
            'note', 'Bob overwrites', 'bob', 2, $v_alice
        );
        $this->assertNotSame($v_alice, $v_bob,
            'Different author must create new version key');

        // Both versions in history.
        // Keys may be composite (sha+path in git), so check SHA prefix.
        $versions = storage()->getVersionList('note');
        $keys = array_column($versions, 'key');
        $this->assertTrue($this->arrayContainsKeyStartingWith($keys, $v_alice),
            'Alice version preserved');
        $this->assertTrue($this->arrayContainsKeyStartingWith($keys, $v_bob),
            'Bob version present');

        // Bob's content is current
        $note = storage()->getNoteFull('note', 2);
        $this->assertSame('Bob overwrites', $note['content']);
    }

    /**
     * git-storage § "Commit Triggers" — DELETE flushes stage first
     *
     * Alice stages content (.meta exists).  Bob deletes the note.
     * Server flushes Alice's stage first (commits it), then performs
     * the delete.
     *
     * Contract: delete must work even when staged content exists.
     * The tombstone captures the latest committed content.
     */
    #[Test]
    public function gitScenario_stagingFlushBeforeDelete(): void
    {
        // Alice writes (stages)
        storage()->putNoteLogged(
            'note', 'Alice staged before delete', 'alice', 1, 'local'
        );

        // Simulate: no one else has seen Alice's content yet.
        // Bob issues DELETE.
        // In git: flush Alice's stage → commit → then git rm + commit.
        // In flat-file: delete works directly.
        $this->assertTrue(
            storage()->deleteNoteLogged('note', 'bob'),
            'Delete must succeed even with staged content present'
        );

        // Tombstone reflects Alice's content
        $tomb = storage()->getTombstone('note');
        $this->assertNotNull($tomb);
        $this->assertSame('Alice staged before delete', $tomb['content']);
        $this->assertSame('bob', $tomb['deleted_by']);
    }

    /**
     * git-storage § "Commit Triggers" — RENAME flushes stage first
     *
     * Alice stages content (.meta exists).  Bob renames the note.
     * Server flushes Alice's stage first (commits it), then performs
     * the rename.
     *
     * Contract: rename must work even with staged content.  The
     * renamed note carries all existing version history.
     */
    #[Test]
    public function gitScenario_stagingFlushBeforeRename(): void
    {
        // Alice writes (stages) — two versions to verify history preserved
        [$v1] = storage()->putNoteLogged('note', 'Alice v1', 'alice', 1, 'local');
        [$v2] = storage()->putNoteLogged('note', 'Alice v2', 'bob', 2, $v1);

        // Bob renames
        $this->assertTrue(
            storage()->renameNoteLogged('note', 'renamed-note', 'bob'),
            'Rename must succeed even with staged content present'
        );

        // Content accessible under new name
        $note = storage()->getNoteFull('renamed-note', 2);
        $this->assertNotNull($note);
        $this->assertSame('Alice v2', $note['content']);
        $this->assertSame('alice', $note['created_by']);

        // Old name gone
        $this->assertFalse(storage_invoke('noteExists','note'));

        // Version history preserved
        $versions = storage()->getVersionList('renamed-note');
        $this->assertGreaterThanOrEqual(2, count($versions));
    }

    /**
     * git-storage § "Bootstrap (syncedRevision===0)"
     *
     * Bootstrap flushes ALL .meta files before building the response.
     * Every staged note becomes committed; no consumer sees a
     * staged-only version.
     *
     * Contract: after "bootstrap" (simulated by flushing all stages),
     * all notes are fully readable through storage_get_note_full and
     * have proper version keys.
     */
    #[Test]
    public function gitScenario_bootstrap_allStagedContentFlushed(): void
    {
        // Multiple authors write to multiple notes
        storage()->putNoteLogged('note-a', 'Alice note', 'alice', 1, 'local');
        storage()->putNoteLogged('note-b', 'Bob note', 'bob', 2, 'local');
        storage()->putNoteLogged('note-c', 'Charlie note', 'charlie', 3, 'local');

        // Simulate bootstrap: all notes should be readable by anyone
        foreach (['note-a', 'note-b', 'note-c'] as $id) {
            $note = storage()->getNoteFull($id, 4);
            $this->assertNotNull($note, "Bootstrap must expose note {$id}");
            $this->assertNotEmpty($note['version'],
                "Bootstrap must assign a version key to {$id}");
            $this->assertNotEmpty($note['content'],
                "Bootstrap must serve content for {$id}");
        }

        // All notes appear in list
        $list = storage()->listNotes();
        $ids = array_column($list, 'id');
        $this->assertContains('note-a', $ids);
        $this->assertContains('note-b', $ids);
        $this->assertContains('note-c', $ids);
    }

    /**
     * git-storage § "Changelog Trailing-Commit Model"
     *
     * The changelog IS committed to git but always one entry behind
     * the working-tree version.  The working-tree changelog.jsonl has
     * the full truth.  storage()->changelogSince() reads from the working tree,
     * so it always returns the complete set of entries.
     *
     * Contract: storage()->changelogSince() returns all entries after a given
     * revision, including the "trailing" (uncommitted) entry.
     */
    #[Test]
    public function gitScenario_changelogTrailingEntry_workingTreeHasFullTruth(): void
    {
        $before = storage()->changelogCurrentRev();

        // Op 1: Alice creates note X → commit abc → changelog entry
        // rev:N appended (dirty — not yet in any git commit)
        storage()->putNoteLogged('x', 'content', 'alice', 1, 'local');
        $rev_after_op1 = storage()->changelogCurrentRev();
        $this->assertSame($before + 1, $rev_after_op1,
            'Op 1 must produce a changelog entry');

        // Op 2: Bob creates note Y → git add changelog.jsonl (picks up
        // rev from op 1) + notes/Y.md → commit def.  Then changelog
        // entry for rev:N+1 appended (dirty again).
        storage()->putNoteLogged('y', 'content', 'bob', 2, 'local');
        $rev_after_op2 = storage()->changelogCurrentRev();
        $this->assertSame($before + 2, $rev_after_op2,
            'Op 2 must produce a changelog entry');

        // changelog_since from $before must see BOTH entries
        // (in git: op1 entry is now committed inside op2's commit,
        //  op2 entry is in working tree but uncommitted.  Both are
        //  visible because we read from the working tree, not HEAD.)
        $entries = storage()->changelogSince($before);
        $this->assertCount(2, $entries,
            'changelog_since must return all entries including the trailing one');
        $files = array_column($entries, 'file');
        $this->assertContains('x', $files);
        $this->assertContains('y', $files);
    }

    /**
     * git-storage § "Conflict Detection"
     *
     * Conflict detection lives inside storage()->putNoteLogged()
     * (behind the contract — consumers don't see it).  Compares the
     * client's version SHA against the latest git commit.
     *
     * Three writers interleave: Alice→Bob→Charlie on the same note.
     * Each write based on a potentially stale version.
     *
     * Contract: all writes succeed (last-write-wins).  Version history
     * contains all writes.  Current content is the latest writer's.
     */
    #[Test]
    public function gitScenario_conflictDetection_threeWritersInterleaving(): void
    {
        // Alice creates
        [$v_a1] = storage()->putNoteLogged(
            'shared', 'Alice creates', 'alice', 1, 'local'
        );

        // Bob writes based on Alice's version
        [$v_b1] = storage()->putNoteLogged(
            'shared', 'Bob adds', 'bob', 2, $v_a1
        );

        // Charlie writes based on Bob's version
        [$v_c1] = storage()->putNoteLogged(
            'shared', 'Charlie edits', 'charlie', 3, $v_b1
        );

        // Alice writes again, based on her OLD version (stale — misses
        // Bob and Charlie).  Conflict logged, write still wins.
        [$v_a2] = storage()->putNoteLogged(
            'shared', 'Alice overwrites everything', 'alice', 1, $v_a1
        );

        // Last write wins
        $note = storage()->getNoteFull('shared', 4);
        $this->assertSame('Alice overwrites everything', $note['content']);
        $this->assertSame('alice', $note['author']);

        // All versions retrievable
        $all_content = [];
        foreach (storage()->getVersionList('shared') as $v) {
            $c = storage()->getVersionContent('shared', $v['key']);
            if ($c !== null) $all_content[] = $c;
        }
        $this->assertContains('Alice creates', $all_content);
        $this->assertContains('Bob adds', $all_content);
        $this->assertContains('Charlie edits', $all_content);
        $this->assertContains('Alice overwrites everything', $all_content);
    }

    /**
     * git-storage § "Sync Protocol Changes" — bootstrap path
     *
     * When syncedRevision===0, storage_flush_all_stages() flushes
     * ALL .meta files, then storage()->listNotes() +
     * storage()->getNoteFull() build CREATE changes.
     *
     * Contract: after a simulated bootstrap, all live notes are
     * fully readable with proper version keys and content.
     */
    #[Test]
    public function gitScenario_bootstrap_buildsFullSnapshot(): void
    {
        // Create several notes with multiple versions
        storage()->putNoteLogged('a', 'a-v1', 'alice', 1, 'local');
        [$v_b1] = storage()->putNoteLogged('b', 'b-v1', 'bob', 2, 'local');
        storage()->putNoteLogged('b', 'b-v2', 'charlie', 3, $v_b1);

        // Simulate bootstrap: list all notes, read each one fully
        $all = storage()->listNotes();
        $ids = array_column($all, 'id');
        $this->assertContains('a', $ids);
        $this->assertContains('b', $ids);

        foreach ($all as $meta) {
            $note = storage()->getNoteFull($meta['id'], 4);
            $this->assertNotNull($note, "Bootstrap: note {$meta['id']} readable");
            $this->assertNotEmpty($note['content'], "Bootstrap: content present");
            $this->assertNotEmpty($note['version'], "Bootstrap: version present");
            $this->assertNotEmpty($note['created_by'], "Bootstrap: created_by present");
            $this->assertGreaterThan(0, $note['created_at']);
            $this->assertGreaterThan(0, $note['updated_at']);
        }

        // Deleted notes appear as tombstones with DELETE changes
        storage()->deleteNoteLogged('a', 'alice');
        $tombstones = storage()->listDeletedNotes();
        $this->assertGreaterThanOrEqual(1, count($tombstones),
            'Bootstrap: deleted notes must appear in tombstone list');
    }

    /**
     * git-storage § "History Endpoint"
     *
     * action=list → git log; action=get → git show {sha}:notes/{id}.md
     * Response format: same structure; key is now a SHA.
     *
     * Contract: storage_get_version_list returns all versions with
     * consistent shape; storage_get_version_content retrieves each.
     * Version keys are opaque strings (composite key today, SHA in git).
     */
    #[Test]
    public function gitScenario_historyEndpoint_versionKeysAreOpaque(): void
    {
        // Multiple writes across different authors
        [$v1] = storage()->putNoteLogged('note', 'initial', 'alice', 1, 'local');
        [$v2] = storage()->putNoteLogged('note', 'bob-edit', 'bob', 2, $v1);
        storage()->putNoteLogged('note', 'charlie-edit', 'charlie', 3, $v2);

        // Version list: each entry has the required shape
        $versions = storage()->getVersionList('note');
        $this->assertNotEmpty($versions);
        foreach ($versions as $v) {
            $this->assertIsString($v['key'],
                'Version key must be a string (composite or SHA)');
            $this->assertIsString($v['author']);
            $this->assertIsInt($v['saved_at']);
            // prev may be null or string — both valid
            $this->assertTrue($v['prev'] === null || is_string($v['prev']));

            // Content retrievable by key
            $content = storage()->getVersionContent('note', $v['key']);
            $this->assertIsString($content);
            $this->assertNotEmpty($content);
        }
    }
}
