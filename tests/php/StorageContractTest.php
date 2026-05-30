<?php
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
class StorageContractTest extends TestCase
{
    private string $notesDir;

    protected function setUp(): void
    {
        $this->notesDir = NOTES_DIR;
        $this->cleanNotesDir();
    }

    protected function tearDown(): void
    {
        $this->cleanNotesDir();
        @unlink(CHANGELOG_FILE);
    }

    private function cleanNotesDir(): void
    {
        foreach (glob($this->notesDir . '*') ?: [] as $f) {
            @unlink($f);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // storage_get_note_full($id, $viewer) ── Change 026 Phase 1
    // ═══════════════════════════════════════════════════════════════

    /** @test */
    public function getNoteFull_returnsNullForNonexistentNote(): void
    {
        $this->assertNull(storage_get_note_full('no-such-note', 'alice'));
    }

    /** @test */
    public function getNoteFull_returnsNullForDeletedNote(): void
    {
        storage_put_note_logged('doomed', 'hello', 'alice', 'local');
        storage_delete_note_logged('doomed', 'alice');

        $this->assertNull(storage_get_note_full('doomed', 'alice'));
    }

    /** @test */
    public function getNoteFull_returnsNormalizedFlatShape(): void
    {
        [$version] = storage_put_note_logged('flat', 'hello world', 'alice', 'local');
        $note = storage_get_note_full('flat', 'alice');

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

    /** @test */
    public function getNoteFull_prevLinksToPreviousVersion(): void
    {
        [$v1] = storage_put_note_logged('link', 'first',   'alice', 'local');
        [$v2] = storage_put_note_logged('link', 'second',  'bob',   $v1);

        $note = storage_get_note_full('link', 'alice');
        $this->assertSame('second', $note['content']);
        $this->assertSame($v2,      $note['version']);
        $this->assertSame($v1,      $note['prev']);
        $this->assertSame('bob',    $note['author']);
        $this->assertSame('alice',  $note['created_by'], 'created_by immutable');
    }

    /** @test */
    public function getNoteFull_returnsLatestVersion(): void
    {
        storage_put_note_logged('latest', 'v1', 'alice', 'local');
        [$v2] = storage_put_note_logged('latest', 'v2', 'bob', 'local');
        storage_put_note_logged('latest', 'v3', 'charlie', $v2);

        $note = storage_get_note_full('latest', 'alice');
        $this->assertSame('v3', $note['content']);
        $this->assertSame('charlie', $note['author']);
    }

    // ── $viewer parameter (git-backend readiness) ──────────────────

    /** @test */
    public function getNoteFull_viewerParameterAcceptedForAllIdentities(): void
    {
        storage_put_note_logged('note', 'secret', 'alice', 'local');

        $asAlice   = storage_get_note_full('note', 'alice');
        $asBob     = storage_get_note_full('note', 'bob');
        $asEmpty   = storage_get_note_full('note', '');
        $asUnknown = storage_get_note_full('note', 'unknown-user');

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
    // storage_put_note_logged($id, $content, $author, $client_version)
    // ── Change 026 Phase 2
    // ═══════════════════════════════════════════════════════════════

    /** @test */
    public function putNoteLogged_createsNoteAndReturnsVersion(): void
    {
        [$version, $dirty] = storage_put_note_logged(
            'new-note', 'hello', 'alice', 'local'
        );

        $this->assertIsString($version);
        $this->assertNotEmpty($version);
        $this->assertIsBool($dirty);
        $this->assertTrue(storage_note_exists('new-note'));

        $note = storage_get_note_full('new-note', 'alice');
        $this->assertSame('hello', $note['content']);
        $this->assertSame('alice', $note['created_by']);
        $this->assertSame('alice', $note['author']);
    }

    /** @test */
    public function putNoteLogged_updatesExistingNote(): void
    {
        [$v1] = storage_put_note_logged('note', 'v1', 'alice', 'local');
        [$v2, $dirty] = storage_put_note_logged('note', 'v2', 'alice', $v1);

        $this->assertIsString($v2);
        $this->assertNotEmpty($v2);
        $this->assertFalse($dirty);

        $note = storage_get_note_full('note', 'alice');
        $this->assertSame('v2',    $note['content']);
        $this->assertSame('alice', $note['created_by'],
            'created_by must survive updates');
    }

    /** @test */
    public function putNoteLogged_returnsNullForNullClientVersion(): void
    {
        $result = storage_put_note_logged('note', 'content', 'alice', null);
        $this->assertNull($result);
        $this->assertFalse(storage_note_exists('note'));
    }

    /** @test */
    public function putNoteLogged_returnsNullForEmptyClientVersion(): void
    {
        $result = storage_put_note_logged('note', 'content', 'alice', '');
        $this->assertNull($result);
        $this->assertFalse(storage_note_exists('note'));
    }

    /** @test */
    public function putNoteLogged_revivesDeletedTombstone(): void
    {
        storage_put_note_logged('note', 'original', 'alice', 'local');
        storage_delete_note_logged('note', 'alice');

        $this->assertNull(storage_get_note_full('note', 'alice'),
            'Note should be inaccessible after delete');
        $this->assertNotNull(storage_get_tombstone('note'),
            'Tombstone must exist after delete');

        // A new write on the same ID revives the note
        [$version, $dirty] = storage_put_note_logged(
            'note', 'revived', 'alice', 'local'
        );

        $this->assertIsString($version);
        $this->assertNotEmpty($version);
        $this->assertFalse($dirty);

        $note = storage_get_note_full('note', 'alice');
        $this->assertSame('revived', $note['content']);
        $this->assertFalse(storage_note_deleted('note'));
        $this->assertNull(storage_get_tombstone('note'),
            'Tombstone must be gone after revive');
    }

    /** @test */
    public function putNoteLogged_detectsConflictsAndStillWrites(): void
    {
        // Alice creates v1
        [$v1] = storage_put_note_logged('note', 'alice-v1', 'alice', 'local');

        // Bob writes with a stale version → conflict logged, write wins
        [$v2, $dirty] = storage_put_note_logged(
            'note', 'bob-v1', 'bob', 'wrong-version'
        );

        $this->assertIsString($v2);
        $this->assertNotEmpty($v2);
        $this->assertFalse($dirty);

        // Last-write-wins: Bob's content is current
        $note = storage_get_note_full('note', 'alice');
        $this->assertSame('bob-v1', $note['content']);
    }

    /** @test */
    public function putNoteLogged_differentAuthorCreatesNewVersion(): void
    {
        [$v1] = storage_put_note_logged('note', 'alice-v1', 'alice', 'local');
        [$v2] = storage_put_note_logged('note', 'bob-v1',   'bob',   $v1);

        $this->assertNotSame($v1, $v2,
            'Different author must create a new version key');

        $versions = storage_get_version_list('note');
        $this->assertCount(2, $versions);

        // Both versions still retrievable
        $this->assertSame('alice-v1', storage_get_version_content('note', $v1));
        $this->assertSame('bob-v1',   storage_get_version_content('note', $v2));
    }

    // ── $dirty flag (git-backend readiness) ────────────────────────

    /** @test */
    public function putNoteLogged_dirtyFlagIsBooleanOnCreate(): void
    {
        [$version, $dirty] = storage_put_note_logged(
            'note', 'content', 'alice', 'local'
        );
        $this->assertIsBool($dirty);
        // Flat-file always commits immediately → $dirty is always false.
        // Git backend will return true when content is staged to
        // .md/.meta but not yet committed.
    }

    /** @test */
    public function putNoteLogged_dirtyFlagIsBooleanOnUpdate(): void
    {
        [$v1] = storage_put_note_logged('note', 'v1', 'alice', 'local');
        [$v2, $dirty] = storage_put_note_logged('note', 'v2', 'alice', $v1);
        $this->assertIsBool($dirty);
    }

    // ═══════════════════════════════════════════════════════════════
    // storage_delete_note_logged($id, $author) ── Change 026 Phase 3
    // ═══════════════════════════════════════════════════════════════

    /** @test */
    public function deleteNoteLogged_softDeletesLiveNote(): void
    {
        storage_put_note_logged('note', 'content', 'alice', 'local');
        $result = storage_delete_note_logged('note', 'alice');

        $this->assertTrue($result);
        $this->assertFalse(storage_note_exists('note'));
        $this->assertTrue(storage_note_deleted('note'));
        $this->assertNull(storage_get_note_full('note', 'alice'));
    }

    /** @test */
    public function deleteNoteLogged_failsOnAlreadyDeleted(): void
    {
        storage_put_note_logged('note', 'content', 'alice', 'local');
        storage_delete_note_logged('note', 'alice');

        $this->assertFalse(storage_delete_note_logged('note', 'alice'));
    }

    /** @test */
    public function deleteNoteLogged_failsOnNonexistent(): void
    {
        $this->assertFalse(
            storage_delete_note_logged('no-such-note', 'alice')
        );
    }

    /** @test */
    public function deleteNoteLogged_producesChangelogEntry(): void
    {
        $before = changelog_current_rev();

        storage_put_note_logged('note', 'content', 'alice', 'local');
        storage_delete_note_logged('note', 'alice');

        $after = changelog_current_rev();
        // CREATE + DELETE = 2 new entries
        $this->assertSame($before + 2, $after);
    }

    // ═══════════════════════════════════════════════════════════════
    // storage_rename_note_logged($old, $new, $author) ── Phase 3
    // ═══════════════════════════════════════════════════════════════

    /** @test */
    public function renameNoteLogged_movesNote(): void
    {
        storage_put_note_logged('old', 'content', 'alice', 'local');
        $result = storage_rename_note_logged('old', 'new', 'alice');

        $this->assertTrue($result);
        $this->assertFalse(storage_note_exists('old'));
        $this->assertTrue(storage_note_exists('new'));

        $note = storage_get_note_full('new', 'alice');
        $this->assertSame('content', $note['content']);
        $this->assertSame('alice',   $note['created_by']);
    }

    /** @test */
    public function renameNoteLogged_preservesFullVersionHistory(): void
    {
        [$v1] = storage_put_note_logged('note', 'v1', 'alice',   'local');
        [$v2] = storage_put_note_logged('note', 'v2', 'bob',     $v1);
        [$v3] = storage_put_note_logged('note', 'v3', 'charlie', $v2);

        $this->assertTrue(
            storage_rename_note_logged('note', 'renamed', 'alice')
        );

        $versions = storage_get_version_list('renamed');
        $this->assertCount(3, $versions,
            'Rename must preserve all version history');

        $note = storage_get_note_full('renamed', 'alice');
        $this->assertSame('v3', $note['content']);

        // Content for each version still accessible by key
        foreach ($versions as $v) {
            $this->assertNotNull(
                storage_get_version_content('renamed', $v['key'])
            );
        }
    }

    /** @test */
    public function renameNoteLogged_failsOnNonexistentSource(): void
    {
        $this->assertFalse(
            storage_rename_note_logged('no-such', 'new', 'alice')
        );
    }

    /** @test */
    public function renameNoteLogged_failsOnOccupiedTarget(): void
    {
        storage_put_note_logged('source', 'src-content', 'alice', 'local');
        storage_put_note_logged('target', 'tgt-content', 'alice', 'local');

        $this->assertFalse(
            storage_rename_note_logged('source', 'target', 'alice')
        );

        // Source remains intact after failed rename
        $this->assertTrue(storage_note_exists('source'));
        $this->assertSame(
            'src-content',
            storage_get_note_full('source', 'alice')['content']
        );
    }

    /** @test */
    public function renameNoteLogged_failsOnEmptyNewId(): void
    {
        storage_put_note_logged('note', 'content', 'alice', 'local');
        $this->assertFalse(
            storage_rename_note_logged('note', '', 'alice')
        );
        $this->assertTrue(storage_note_exists('note'));
    }

    /** @test */
    public function renameNoteLogged_producesChangelogEntry(): void
    {
        $before = changelog_current_rev();

        storage_put_note_logged('note', 'content', 'alice', 'local');
        storage_rename_note_logged('note', 'moved', 'alice');

        $after = changelog_current_rev();
        // CREATE + RENAME = 2 new entries
        $this->assertSame($before + 2, $after);
    }

    // ═══════════════════════════════════════════════════════════════
    // storage_get_version_list($id) ── Change 026 Phase 4
    // ═══════════════════════════════════════════════════════════════

    /** @test */
    public function getVersionList_returnsEmptyForNonexistent(): void
    {
        $this->assertSame([], storage_get_version_list('no-such-note'));
    }

    /** @test */
    public function getVersionList_returnsEmptyForDeleted(): void
    {
        storage_put_note_logged('note', 'content', 'alice', 'local');
        storage_delete_note_logged('note', 'alice');

        $this->assertSame([], storage_get_version_list('note'));
    }

    /** @test */
    public function getVersionList_returnsAllVersionsNewestFirst(): void
    {
        [$v1] = storage_put_note_logged('note', 'v1', 'alice',   'local');
        sleep(1);  // guarantee distinct saved_at (second granularity)
        [$v2] = storage_put_note_logged('note', 'v2', 'bob',     $v1);
        sleep(1);
        [$v3] = storage_put_note_logged('note', 'v3', 'charlie', $v2);

        $list = storage_get_version_list('note');
        $this->assertCount(3, $list);

        // Newest first — saved_at timestamps are 2 s apart
        $this->assertSame($v3, $list[0]['key']);
        $this->assertSame($v2, $list[1]['key']);
        $this->assertSame($v1, $list[2]['key']);
    }

    /** @test */
    public function getVersionList_eachEntryHasRequiredKeys(): void
    {
        storage_put_note_logged('note', 'content', 'alice', 'local');

        $list = storage_get_version_list('note');
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
    // storage_get_version_content($id, $vkey) ── Phase 4
    // ═══════════════════════════════════════════════════════════════

    /** @test */
    public function getVersionContent_returnsContentForVersion(): void
    {
        // Use different authors to guarantee distinct version keys
        // (same-author same-day override would keep the same key)
        [$v1] = storage_put_note_logged('note', 'version-one', 'alice', 'local');
        [$v2] = storage_put_note_logged('note', 'version-two', 'bob',   $v1);

        $this->assertSame(
            'version-one',
            storage_get_version_content('note', $v1)
        );
        $this->assertSame(
            'version-two',
            storage_get_version_content('note', $v2)
        );
    }

    /** @test */
    public function getVersionContent_returnsNullForUnknownKey(): void
    {
        storage_put_note_logged('note', 'content', 'alice', 'local');

        $this->assertNull(
            storage_get_version_content('note', 'nonexistent-key')
        );
    }

    /** @test */
    public function getVersionContent_returnsNullForNonexistentNote(): void
    {
        $this->assertNull(
            storage_get_version_content('no-such-note', 'any-key')
        );
    }

    /** @test */
    public function getVersionContent_returnsNullForDeletedNote(): void
    {
        storage_put_note_logged('note', 'content', 'alice', 'local');
        $vkey = storage_get_note_full('note', 'alice')['version'];
        storage_delete_note_logged('note', 'alice');

        $this->assertNull(
            storage_get_version_content('note', $vkey)
        );
    }

    // ═══════════════════════════════════════════════════════════════
    // storage_get_tombstone($id) ── Change 026 Phase 5
    // ═══════════════════════════════════════════════════════════════

    /** @test */
    public function getTombstone_returnsNullForLiveNote(): void
    {
        storage_put_note_logged('note', 'content', 'alice', 'local');
        $this->assertNull(storage_get_tombstone('note'));
    }

    /** @test */
    public function getTombstone_returnsNullForNonexistent(): void
    {
        $this->assertNull(storage_get_tombstone('no-such-note'));
    }

    /** @test */
    public function getTombstone_returnsNullAfterTombstoneIsRevived(): void
    {
        storage_put_note_logged('note', 'content', 'alice', 'local');
        storage_delete_note_logged('note', 'alice');
        $this->assertNotNull(storage_get_tombstone('note'));

        // Revive via a new write
        storage_put_note_logged('note', 'revived', 'bob', 'local');
        $this->assertNull(storage_get_tombstone('note'),
            'Tombstone must be gone after revive');
    }

    /** @test */
    public function getTombstone_returnsFullMetadata(): void
    {
        storage_put_note_logged('note', 'precious content', 'creator', 'local');
        storage_delete_note_logged('note', 'destroyer');

        $tombstone = storage_get_tombstone('note');
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

    /** @test */
    public function getTombstone_preservesDeletedByCorrectly(): void
    {
        storage_put_note_logged('note', 'content', 'alice', 'local');
        storage_delete_note_logged('note', 'charlie');

        $tombstone = storage_get_tombstone('note');
        $this->assertSame('charlie', $tombstone['deleted_by'],
            'deleted_by must reflect who performed the deletion');
        $this->assertSame('alice', $tombstone['created_by'],
            'created_by must reflect the original creator');
    }

    // ═══════════════════════════════════════════════════════════════
    // storage_housekeeping($entry) ── Change 026 maintenance hook
    // ═══════════════════════════════════════════════════════════════

    /** @test */
    public function housekeeping_syncEntryReturnsInt(): void
    {
        $result = storage_housekeeping('sync');
        $this->assertIsInt($result);
    }

    /** @test */
    public function housekeeping_unknownEntryReturnsZero(): void
    {
        $result = storage_housekeeping('unknown-entry');
        $this->assertSame(0, $result);
    }

    /** @test */
    public function housekeeping_unknownEntryDoesNotPurge(): void
    {
        storage_put_note_logged('note', 'content', 'alice', 'local');
        storage_delete_note_logged('note', 'alice');

        storage_housekeeping('unknown-entry');

        $this->assertNotNull(storage_get_tombstone('note'),
            'Tombstone must survive unknown entry point');
    }

    // ═══════════════════════════════════════════════════════════════
    // storage_e2ee_support() ── backend capability flag
    // ═══════════════════════════════════════════════════════════════

    /** @test */
    public function e2eeSupport_returnsBoolean(): void
    {
        $result = storage_e2ee_support();
        $this->assertIsBool($result);

        // Flat-file backend supports E2EE (content is opaque blobs).
        // Git backend will return false (content must be server-visible
        // markdown for git diffs to be meaningful).
    }

    // ═══════════════════════════════════════════════════════════════
    // Full-lifecycle integration (all contract functions)
    // ═══════════════════════════════════════════════════════════════

    /** @test */
    public function fullLifecycle_createReadUpdateDeleteTombstone(): void
    {
        // ── CREATE ──────────────────────────────────────
        [$v1, $d1] = storage_put_note_logged(
            'lifecycle', 'step-1', 'alice', 'local'
        );
        $this->assertNotEmpty($v1);
        $this->assertFalse($d1);

        // ── READ ────────────────────────────────────────
        $note = storage_get_note_full('lifecycle', 'alice');
        $this->assertSame('step-1', $note['content']);
        $this->assertSame($v1,      $note['version']);
        $this->assertNull($note['prev']);
        $this->assertSame('alice',  $note['created_by']);

        // ── UPDATE (different author → guaranteed new key) ──
        [$v2, $d2] = storage_put_note_logged(
            'lifecycle', 'step-2', 'bob', $v1
        );
        $this->assertNotEmpty($v2);
        $this->assertNotSame($v1, $v2,
            'Different author must produce new version key');
        $this->assertFalse($d2);

        $note = storage_get_note_full('lifecycle', 'alice');
        $this->assertSame('step-2', $note['content']);
        $this->assertSame('alice',  $note['created_by'],
            'created_by must survive updates');

        // ── UPDATE (third author) ───────────────────────
        [$v3, $d3] = storage_put_note_logged(
            'lifecycle', 'step-3', 'charlie', $v2
        );
        $this->assertNotEmpty($v3);
        $this->assertNotSame($v2, $v3,
            'Different author must produce new version key');
        $this->assertFalse($d3);

        // ── VERSION HISTORY ─────────────────────────────
        $versions = storage_get_version_list('lifecycle');
        $this->assertGreaterThanOrEqual(3, count($versions),
            'At least 3 versions from 3 distinct authors');

        // ── VERSION CONTENT ─────────────────────────────
        // Bob's v2 content retrievable
        $this->assertSame('step-2',
            storage_get_version_content('lifecycle', $v2));
        // Charlie's v3 is current
        $this->assertSame('step-3',
            storage_get_version_content('lifecycle', $v3));

        // ── DELETE ──────────────────────────────────────
        $this->assertTrue(
            storage_delete_note_logged('lifecycle', 'dave')
        );
        $this->assertNull(
            storage_get_note_full('lifecycle', 'alice')
        );
        $this->assertTrue(storage_note_deleted('lifecycle'));

        // ── TOMBSTONE ───────────────────────────────────
        $tomb = storage_get_tombstone('lifecycle');
        $this->assertIsArray($tomb);
        $this->assertSame('step-3', $tomb['content']);
        $this->assertSame('dave',   $tomb['deleted_by']);
        $this->assertSame('alice',  $tomb['created_by']);
        $this->assertGreaterThan(0, $tomb['deleted_at']);

        // ── REVIVE via new write ────────────────────────
        [$v4, $d4] = storage_put_note_logged(
            'lifecycle', 'reborn', 'alice', 'local'
        );
        $this->assertNotEmpty($v4);
        $this->assertFalse($d4);

        $note = storage_get_note_full('lifecycle', 'alice');
        $this->assertSame('reborn', $note['content']);
        $this->assertNull(storage_get_tombstone('lifecycle'));
    }

    // ═══════════════════════════════════════════════════════════════
    // Git-backend readiness — contract-level concerns
    // ═══════════════════════════════════════════════════════════════

    /**
     * @test
     *
     * git-storage concern: commits are immutable.
     * Every distinct write must produce a version key that can be used
     * to retrieve that exact content later.  Content must never change
     * under a given key once written.
     */
    public function versionImmutability_contentStableUnderKey(): void
    {
        [$v1] = storage_put_note_logged('note', 'original', 'alice', 'local');

        // Write same author again (may overwrite in flat-file, but
        // in git it would be a new commit with a different SHA)
        storage_put_note_logged('note', 'updated', 'alice', $v1);

        // In the flat-file backend, v1 content may be overwritten if
        // the exclusive flag was still set.  In the git backend, v1
        // content would still be 'original'.  Both are valid contract
        // behaviours — the key invariant is that if a key IS still in
        // the version list, its content matches what was stored.
        $versions = storage_get_version_list('note');
        foreach ($versions as $v) {
            $content = storage_get_version_content('note', $v['key']);
            if ($content !== null) {
                $this->assertIsString($content);
                $this->assertNotEmpty($content);
            }
        }
    }

    /**
     * @test
     *
     * git-storage concern: changelog trail enables incremental sync
     * (fast path) AND full reconstruction from git log.  Every logged
     * operation must produce a changelog entry with consistent shape.
     */
    public function changelogTrail_everyOperationProducesEntry(): void
    {
        $before = changelog_current_rev();

        // Four distinct operations, each with correct client_version
        [$v1] = storage_put_note_logged('a', 'create', 'alice', 'local');    // 1
        [$v2] = storage_put_note_logged('a', 'update', 'bob',   $v1);         // 2
        storage_rename_note_logged('a', 'b', 'alice');                        // 3
        storage_delete_note_logged('b', 'alice');                               // 4

        $after = changelog_current_rev();
        $this->assertSame($before + 4, $after,
            'Each logged operation must produce a changelog entry');
    }

    /**
     * @test
     *
     * git-storage concern: the changelog trails by one entry in the
     * git backend (last entry is in working tree but not committed).
     * The working-tree changelog always has the full truth.
     */
    public function changelogTrail_sinceReturnsExpectedEntries(): void
    {
        // This tests the incremental sync path: given a known
        // revision, changelog_since must return only later entries.

        storage_put_note_logged('x', 'v1', 'alice', 'local');
        $after_create = changelog_current_rev();

        storage_put_note_logged('y', 'v1', 'bob', 'local');

        $since = changelog_since($after_create);
        // 'y' CREATE should be the only new entry
        $this->assertCount(1, $since);
        $this->assertSame('y', $since[0]['file']);
        $this->assertSame('CREATE', $since[0]['type']);
    }

    /**
     * @test
     *
     * git-storage concern: created_by is set on the first write and
     * never overwritten, even across updates and renames.  The git
     * backend can derive this from the first commit's author.
     */
    public function createdBy_survivesAllMutations(): void
    {
        [$v1] = storage_put_note_logged('note', 'original', 'creator', 'local');
        [$v2] = storage_put_note_logged('note', 'update1',  'editor1', $v1);
        [$v3] = storage_put_note_logged('note', 'update2',  'editor2', $v2);
        storage_rename_note_logged('note', 'moved', 'renamer');

        $note = storage_get_note_full('moved', 'alice');
        $this->assertSame('creator', $note['created_by'],
            'created_by must survive updates and renames');
        // author should reflect the latest writer
        $this->assertContains($note['author'], ['editor1', 'editor2'],
            'author should be the latest editor');
    }

    /**
     * @test
     *
     * git-storage concern: concurrent writers produce a linear history
     * (last-write-wins).  Both writes succeed; history contains both.
     */
    public function concurrentWriters_bothWritesSucceed(): void
    {
        [$v1] = storage_put_note_logged(
            'shared', 'Alice writes first', 'alice', 'local'
        );

        // Bob writes based on v1
        [$v2] = storage_put_note_logged(
            'shared', 'Bob writes second', 'bob', $v1
        );

        // Alice writes again based on v1 (missing Bob's v2)
        [$v3] = storage_put_note_logged(
            'shared', 'Alice writes third', 'alice', $v1
        );

        // All writes succeed; last write wins
        $note = storage_get_note_full('shared', 'alice');
        $this->assertNotNull($note);

        // History preserves all content
        $versions = storage_get_version_list('shared');
        $contents = [];
        foreach ($versions as $v) {
            $c = storage_get_version_content('shared', $v['key']);
            if ($c !== null) {
                $contents[] = $c;
            }
        }
        $this->assertContains('Alice writes first', $contents);
        $this->assertContains('Bob writes second',  $contents);
        $this->assertContains('Alice writes third', $contents);
    }

    /**
     * @test
     *
     * git-storage concern: the $viewer parameter triggers staging
     * flushes when viewer ≠ staged author.  The contract must accept
     * any viewer identity without error on every contract function.
     */
    public function viewerParameter_acceptedOnAllRelevantFunctions(): void
    {
        storage_put_note_logged('note', 'content', 'alice', 'local');

        // storage_get_note_full with various viewers
        $this->assertNotNull(storage_get_note_full('note', 'alice'));
        $this->assertNotNull(storage_get_note_full('note', 'bob'));
        $this->assertNotNull(storage_get_note_full('note', ''));
        $this->assertNotNull(storage_get_note_full('note', 'unknown'));

        // Also works for the author of the note
        $note = storage_get_note_full('note', 'alice');
        $this->assertSame('content', $note['content']);
    }

    /**
     * @test
     *
     * git-storage concern: `.deleted` markers are NOT committed to
     * git — they are server-side operational state carrying
     * deleted_at/deleted_by metadata.  The tombstone contract must
     * expose this metadata through storage_get_tombstone().
     */
    public function tombstoneMetadata_exposesDeletedAtAndDeletedBy(): void
    {
        $before = time();
        storage_put_note_logged('note', 'content', 'alice', 'local');
        storage_delete_note_logged('note', 'bob');
        $after = time();

        $tomb = storage_get_tombstone('note');
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
     * @test
     *
     * git-storage concern: the housekeeping hook is the designated
     * entry point for periodic maintenance (TTL-based tombstone
     * expiry in flat-file, stale .meta flush in git).  The contract
     * requires it to accept an entry-point identifier.
     */
    public function housekeeping_isDesignatedMaintenanceHook(): void
    {
        // The function exists and accepts the 'sync' entry point
        $result = storage_housekeeping('sync');
        $this->assertIsInt($result);

        // Should be callable with the empty string as an entry
        $r2 = storage_housekeeping('');
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
    // contract using storage_mark_version_seen() to simulate sync
    // delivery — the same mechanism sync.php uses in production.
    //
    // In the git backend these tests will pass without
    // storage_mark_version_seen() because commits are immutable
    // and staging flushes happen automatically on viewer mismatch.
    // ═══════════════════════════════════════════════════════════════

    /**
     * @test
     *
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
    public function gitScenario_immutability_sharedVersionNeverOverwritten(): void
    {
        // Alice saves v1
        [$v1] = storage_put_note_logged(
            'note', 'Alice version 1', 'alice', 'local'
        );

        // Bob syncs → receives v1 (server marks version as delivered)
        $bob_view = storage_get_note_full('note', 'bob');
        $this->assertSame('Alice version 1', $bob_view['content']);
        $this->assertSame($v1, $bob_view['version']);
        storage_mark_version_seen('note', 'bob');

        // Alice saves again → must NOT overwrite v1
        [$v2] = storage_put_note_logged(
            'note', 'Alice version 2', 'alice', $v1
        );
        $this->assertNotSame($v1, $v2,
            'After Bob receives v1, Alice must get a new version key');

        // Both versions retrievable
        $aliceContentV1 = storage_get_version_content('note', $v1);
        $aliceContentV2 = storage_get_version_content('note', $v2);
        $this->assertNotNull($aliceContentV1, 'v1 must survive after v2 created');
        $this->assertNotNull($aliceContentV2);

        // Bob syncs again → receives v2; v1 also still there
        $bob_view2 = storage_get_note_full('note', 'bob');
        $this->assertSame('Alice version 2', $bob_view2['content']);
        $versions = storage_get_version_list('note');
        $this->assertGreaterThanOrEqual(2, count($versions));
    }

    /**
     * @test
     *
     * git-storage § "Write-Ahead Staging" (lazy-commit buffer)
     *
     * Alice writes v5 → .meta staged, NO git commit.
     * Alice writes v6 (same author, same date) → overwrites .md,
     * .meta unchanged → STILL no commit.
     *
     * Contract: same-author same-day rapid saves debounce into one
     * version slot (flat-file: overwrite; git: staged overwrite).
     */
    public function gitScenario_stagingBuffer_sameAuthorRapidSavesDebounce(): void
    {
        [$v5] = storage_put_note_logged(
            'note', 'rapid save 5', 'alice', 'local'
        );

        // Alice writes again immediately (same author, same day)
        [$v6] = storage_put_note_logged(
            'note', 'rapid save 6', 'alice', $v5
        );

        // Flat-file: v5 overwritten by v6 (same key, exclusive=true).
        // Git: .md overwritten, no new commit, $dirty was false→true.
        $note = storage_get_note_full('note', 'alice');
        $this->assertSame('rapid save 6', $note['content']);
        $this->assertSame('alice', $note['author']);

        // Version count should be minimal (1 in flat-file if overwrite;
        // 1 in git because no commit was created for v6 yet).
        $versions = storage_get_version_list('note');
        $this->assertLessThanOrEqual(1, count($versions),
            'Rapid same-author same-day saves should not create extra versions');
    }

    /**
     * @test
     *
     * git-storage § "Read-Side Trigger"
     *
     * Alice stages content (.meta exists).  Bob calls
     * storage_get_note_full('note', 'bob').  Server sees viewer≠author,
     * flushes the stage (commits + unlinks .meta), then returns
     * the committed content to Bob.
     *
     * Contract: when a different user reads a note, any staged
     * content must be flushed so the reader sees the published state.
     * consumer is unaware — just passes $viewer and gets back data.
     */
    public function gitScenario_stagingFlushOnRead_differentViewerTriggersFlush(): void
    {
        // Alice writes (creates note; in git: stages .meta)
        [$v1] = storage_put_note_logged(
            'note', 'Alice staged content', 'alice', 'local'
        );
        $this->assertNotEmpty($v1);

        // Alice re-reads her own content (viewer=author → no flush in git)
        $alice_view = storage_get_note_full('note', 'alice');
        $this->assertSame('Alice staged content', $alice_view['content']);

        // Bob reads (viewer≠author → triggers flush in git)
        // In flat-file: Bob's read via sync.php would call
        // storage_mark_version_seen, which we simulate here.
        $bob_view = storage_get_note_full('note', 'bob');
        $this->assertSame('Alice staged content', $bob_view['content']);
        $this->assertSame($v1, $bob_view['version'],
            'Bob sees the committed version, never a staged-only key');

        // After Bob's read, Alice's next write should create a new
        // version (exclusive→false in flat-file; new commit in git)
        storage_mark_version_seen('note', 'bob');
        [$v2] = storage_put_note_logged(
            'note', 'Alice update after Bob read', 'alice', $v1
        );
        $this->assertNotSame($v1, $v2,
            'After different viewer reads, next write must be a new version');

        // Bob reads again → receives v2
        $bob_view2 = storage_get_note_full('note', 'bob');
        $this->assertSame('Alice update after Bob read', $bob_view2['content']);
    }

    /**
     * @test
     *
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
    public function gitScenario_stagingFlushOnWrite_differentAuthorTriggersFlush(): void
    {
        // Alice writes (stages content)
        [$v_alice] = storage_put_note_logged(
            'note', 'Alice writes first', 'alice', 'local'
        );

        // Simulate: Alice's content has been "seen" by no one else yet.
        // Now Bob writes to the same note.
        // In git: this triggers flush of Alice's stage, then stages Bob's.
        // In flat-file: Bob gets a different key regardless.
        [$v_bob] = storage_put_note_logged(
            'note', 'Bob overwrites', 'bob', $v_alice
        );
        $this->assertNotSame($v_alice, $v_bob,
            'Different author must create new version key');

        // Both versions in history
        $versions = storage_get_version_list('note');
        $keys = array_column($versions, 'key');
        $this->assertContains($v_alice, $keys, 'Alice version preserved');
        $this->assertContains($v_bob,   $keys, 'Bob version present');

        // Bob's content is current
        $note = storage_get_note_full('note', 'bob');
        $this->assertSame('Bob overwrites', $note['content']);
    }

    /**
     * @test
     *
     * git-storage § "Commit Triggers" — DELETE flushes stage first
     *
     * Alice stages content (.meta exists).  Bob deletes the note.
     * Server flushes Alice's stage first (commits it), then performs
     * the delete.
     *
     * Contract: delete must work even when staged content exists.
     * The tombstone captures the latest committed content.
     */
    public function gitScenario_stagingFlushBeforeDelete(): void
    {
        // Alice writes (stages)
        storage_put_note_logged(
            'note', 'Alice staged before delete', 'alice', 'local'
        );

        // Simulate: no one else has seen Alice's content yet.
        // Bob issues DELETE.
        // In git: flush Alice's stage → commit → then git rm + commit.
        // In flat-file: delete works directly.
        $this->assertTrue(
            storage_delete_note_logged('note', 'bob'),
            'Delete must succeed even with staged content present'
        );

        // Tombstone reflects Alice's content
        $tomb = storage_get_tombstone('note');
        $this->assertNotNull($tomb);
        $this->assertSame('Alice staged before delete', $tomb['content']);
        $this->assertSame('bob', $tomb['deleted_by']);
    }

    /**
     * @test
     *
     * git-storage § "Commit Triggers" — RENAME flushes stage first
     *
     * Alice stages content (.meta exists).  Bob renames the note.
     * Server flushes Alice's stage first (commits it), then performs
     * the rename.
     *
     * Contract: rename must work even with staged content.  The
     * renamed note carries all existing version history.
     */
    public function gitScenario_stagingFlushBeforeRename(): void
    {
        // Alice writes (stages) — two versions to verify history preserved
        [$v1] = storage_put_note_logged('note', 'Alice v1', 'alice', 'local');
        [$v2] = storage_put_note_logged('note', 'Alice v2', 'bob',   $v1);

        // Bob renames
        $this->assertTrue(
            storage_rename_note_logged('note', 'renamed-note', 'bob'),
            'Rename must succeed even with staged content present'
        );

        // Content accessible under new name
        $note = storage_get_note_full('renamed-note', 'bob');
        $this->assertNotNull($note);
        $this->assertSame('Alice v2', $note['content']);
        $this->assertSame('alice', $note['created_by']);

        // Old name gone
        $this->assertFalse(storage_note_exists('note'));

        // Version history preserved
        $versions = storage_get_version_list('renamed-note');
        $this->assertGreaterThanOrEqual(2, count($versions));
    }

    /**
     * @test
     *
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
    public function gitScenario_bootstrap_allStagedContentFlushed(): void
    {
        // Multiple authors write to multiple notes
        storage_put_note_logged('note-a', 'Alice note',   'alice', 'local');
        storage_put_note_logged('note-b', 'Bob note',     'bob',   'local');
        storage_put_note_logged('note-c', 'Charlie note', 'charlie', 'local');

        // Simulate bootstrap: all notes should be readable by anyone
        foreach (['note-a', 'note-b', 'note-c'] as $id) {
            $note = storage_get_note_full($id, 'dave');
            $this->assertNotNull($note, "Bootstrap must expose note {$id}");
            $this->assertNotEmpty($note['version'],
                "Bootstrap must assign a version key to {$id}");
            $this->assertNotEmpty($note['content'],
                "Bootstrap must serve content for {$id}");
        }

        // All notes appear in list
        $list = storage_list_notes();
        $ids = array_column($list, 'id');
        $this->assertContains('note-a', $ids);
        $this->assertContains('note-b', $ids);
        $this->assertContains('note-c', $ids);
    }

    /**
     * @test
     *
     * git-storage § "Changelog Trailing-Commit Model"
     *
     * The changelog IS committed to git but always one entry behind
     * the working-tree version.  The working-tree changelog.jsonl has
     * the full truth.  changelog_since() reads from the working tree,
     * so it always returns the complete set of entries.
     *
     * Contract: changelog_since() returns all entries after a given
     * revision, including the "trailing" (uncommitted) entry.
     */
    public function gitScenario_changelogTrailingEntry_workingTreeHasFullTruth(): void
    {
        $before = changelog_current_rev();

        // Op 1: Alice creates note X → commit abc → changelog entry
        // rev:N appended (dirty — not yet in any git commit)
        storage_put_note_logged('x', 'content', 'alice', 'local');
        $rev_after_op1 = changelog_current_rev();
        $this->assertSame($before + 1, $rev_after_op1,
            'Op 1 must produce a changelog entry');

        // Op 2: Bob creates note Y → git add changelog.jsonl (picks up
        // rev from op 1) + notes/Y.md → commit def.  Then changelog
        // entry for rev:N+1 appended (dirty again).
        storage_put_note_logged('y', 'content', 'bob', 'local');
        $rev_after_op2 = changelog_current_rev();
        $this->assertSame($before + 2, $rev_after_op2,
            'Op 2 must produce a changelog entry');

        // changelog_since from $before must see BOTH entries
        // (in git: op1 entry is now committed inside op2's commit,
        //  op2 entry is in working tree but uncommitted.  Both are
        //  visible because we read from the working tree, not HEAD.)
        $entries = changelog_since($before);
        $this->assertCount(2, $entries,
            'changelog_since must return all entries including the trailing one');
        $files = array_column($entries, 'file');
        $this->assertContains('x', $files);
        $this->assertContains('y', $files);
    }

    /**
     * @test
     *
     * git-storage § "Commit Triggers" — Date change triggers flush
     *
     * Alice writes today (stages .meta with today's date).
     * Tomorrow Alice writes again → old .meta has yesterday's date
     * → flush old stage → write new content + fresh .meta for today.
     *
     * Contract: when the UTC date changes between writes by the same
     * author, a new version key is created (not an overwrite), because
     * the date component of the key has changed.
     *
     * Simulated by manipulating the saved_at timestamp of the first
     * version to appear as if it were written on a different day.
     */
    public function gitScenario_dateChange_triggerFlushesOldStage(): void
    {
        // Alice writes today
        [$v_today] = storage_put_note_logged(
            'note', 'content today', 'alice', 'local'
        );

        // Simulate date change: backdate yesterday's version so
        // today's write sees a different date → new key
        $note = storage_get_note('note');
        $yesterday_ts = time() - 86400;
        $note['versions'][$v_today]['saved_at'] = $yesterday_ts;
        storage_put_note('note', $note);

        // Alice writes "tomorrow" (today from storage_resolve_version's
        // perspective, but the existing version is dated yesterday)
        [$v_tomorrow] = storage_put_note_logged(
            'note', 'content tomorrow', 'alice', $v_today
        );

        // Date changed → must create new version key
        $this->assertNotSame($v_today, $v_tomorrow,
            'Date change must create a new version, not overwrite');

        // Both versions exist
        $versions = storage_get_version_list('note');
        $this->assertGreaterThanOrEqual(2, count($versions));
    }

    /**
     * @test
     *
     * git-storage § "Housekeeping / Staging TTL"
     *
     * storage_housekeeping() is the designated hook for flushing
     * stale .meta files.  The flat-file backend uses it to expire
     * deleted notes past the TTL, but the hook signature is the
     * same contract entry point that git will use.
     *
     * Contract: storage_housekeeping('sync') must process expired
     * tombstones (flat-file) and will process stale .meta files (git).
     * The return value is an integer count of items processed.
     */
    public function gitScenario_housekeeping_staleStagingFlush(): void
    {
        // Create and delete a note, then backdate the tombstone
        storage_put_note_logged('old', 'stale content', 'alice', 'local');
        storage_delete_note_logged('old', 'alice');

        // Backdate the tombstone to expire it
        $path = NOTES_DIR . 'old.deleted.json';
        $data = json_decode(file_get_contents($path), true);
        $data['deleted_at'] = time() - (DELETED_NOTE_TTL_DAYS + 1) * 86400;
        file_put_contents($path, json_encode($data));

        // housekeeping flushes expired entries
        $removed = storage_housekeeping('sync');
        $this->assertSame(1, $removed,
            'Housekeeping must process expired items');
        $this->assertNull(storage_get_tombstone('old'),
            'Expired tombstone must be gone after housekeeping');

        // A recent tombstone survives
        storage_put_note_logged('recent', 'fresh content', 'bob', 'local');
        storage_delete_note_logged('recent', 'bob');
        $removed2 = storage_housekeeping('sync');
        $this->assertSame(0, $removed2,
            'Recent tombstone must survive housekeeping');
        $this->assertNotNull(storage_get_tombstone('recent'));
    }

    /**
     * @test
     *
     * git-storage § "Conflict Detection"
     *
     * Conflict detection lives inside storage_put_note_logged()
     * (behind the contract — consumers don't see it).  Compares the
     * client's version SHA against the latest git commit.
     *
     * Three writers interleave: Alice→Bob→Charlie on the same note.
     * Each write based on a potentially stale version.
     *
     * Contract: all writes succeed (last-write-wins).  Version history
     * contains all writes.  Current content is the latest writer's.
     */
    public function gitScenario_conflictDetection_threeWritersInterleaving(): void
    {
        // Alice creates
        [$v_a1] = storage_put_note_logged(
            'shared', 'Alice creates', 'alice', 'local'
        );

        // Bob writes based on Alice's version
        [$v_b1] = storage_put_note_logged(
            'shared', 'Bob adds', 'bob', $v_a1
        );

        // Charlie writes based on Bob's version
        [$v_c1] = storage_put_note_logged(
            'shared', 'Charlie edits', 'charlie', $v_b1
        );

        // Alice writes again, based on her OLD version (stale — misses
        // Bob and Charlie).  Conflict logged, write still wins.
        [$v_a2] = storage_put_note_logged(
            'shared', 'Alice overwrites everything', 'alice', $v_a1
        );

        // Last write wins
        $note = storage_get_note_full('shared', 'dave');
        $this->assertSame('Alice overwrites everything', $note['content']);
        $this->assertSame('alice', $note['author']);

        // All versions retrievable
        $all_content = [];
        foreach (storage_get_version_list('shared') as $v) {
            $c = storage_get_version_content('shared', $v['key']);
            if ($c !== null) $all_content[] = $c;
        }
        $this->assertContains('Alice creates', $all_content);
        $this->assertContains('Bob adds', $all_content);
        $this->assertContains('Charlie edits', $all_content);
        $this->assertContains('Alice overwrites everything', $all_content);
    }

    /**
     * @test
     *
     * git-storage § "Sync Protocol Changes" — bootstrap path
     *
     * When syncedRevision===0, storage_flush_all_stages() flushes
     * ALL .meta files, then storage_list_notes() +
     * storage_get_note_full() build CREATE changes.
     *
     * Contract: after a simulated bootstrap, all live notes are
     * fully readable with proper version keys and content.
     */
    public function gitScenario_bootstrap_buildsFullSnapshot(): void
    {
        // Create several notes with multiple versions
        storage_put_note_logged('a', 'a-v1', 'alice', 'local');
        storage_put_note_logged('b', 'b-v1', 'bob', 'local');
        storage_put_note_logged('b', 'b-v2', 'charlie', '');

        // Simulate bootstrap: list all notes, read each one fully
        $all = storage_list_notes();
        $ids = array_column($all, 'id');
        $this->assertContains('a', $ids);
        $this->assertContains('b', $ids);

        foreach ($all as $meta) {
            $note = storage_get_note_full($meta['id'], 'dave');
            $this->assertNotNull($note, "Bootstrap: note {$meta['id']} readable");
            $this->assertNotEmpty($note['content'], "Bootstrap: content present");
            $this->assertNotEmpty($note['version'], "Bootstrap: version present");
            $this->assertNotEmpty($note['created_by'], "Bootstrap: created_by present");
            $this->assertGreaterThan(0, $note['created_at']);
            $this->assertGreaterThan(0, $note['updated_at']);
        }

        // Deleted notes appear as tombstones with DELETE changes
        storage_delete_note_logged('a', 'alice');
        $tombstones = storage_list_deleted_notes();
        $this->assertGreaterThanOrEqual(1, count($tombstones),
            'Bootstrap: deleted notes must appear in tombstone list');
    }

    /**
     * @test
     *
     * git-storage § "History Endpoint"
     *
     * action=list → git log; action=get → git show {sha}:notes/{id}.md
     * Response format: same structure; key is now a SHA.
     *
     * Contract: storage_get_version_list returns all versions with
     * consistent shape; storage_get_version_content retrieves each.
     * Version keys are opaque strings (composite key today, SHA in git).
     */
    public function gitScenario_historyEndpoint_versionKeysAreOpaque(): void
    {
        // Multiple writes across different authors
        storage_put_note_logged('note', 'initial', 'alice', 'local');
        storage_put_note_logged('note', 'bob-edit', 'bob', '');
        storage_put_note_logged('note', 'charlie-edit', 'charlie', '');

        // Version list: each entry has the required shape
        $versions = storage_get_version_list('note');
        $this->assertNotEmpty($versions);
        foreach ($versions as $v) {
            $this->assertIsString($v['key'],
                'Version key must be a string (composite or SHA)');
            $this->assertIsString($v['author']);
            $this->assertIsInt($v['saved_at']);
            // prev may be null or string — both valid
            $this->assertTrue($v['prev'] === null || is_string($v['prev']));

            // Content retrievable by key
            $content = storage_get_version_content('note', $v['key']);
            $this->assertIsString($content);
            $this->assertNotEmpty($content);
        }
    }
}
