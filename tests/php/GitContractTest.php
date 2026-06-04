<?php
use PHPUnit\Framework\Attributes\Test;

require_once __DIR__ . '/StorageContractTestBase.php';

/**
 * GitContractTest — runs all contract tests against GitStorage.
 *
 * Uses STAGE_FLUSH_HOURS=0 (defined in bootstrap.php) so every write
 * commits immediately — no staging.  This ensures the baseline contract
 * assertions (version is a string, dirty=false) pass for the git backend.
 *
 * Also includes git-specific tests for staging, path conversion, and
 * the trailing-commit changelog model.
 */
class GitContractTest extends StorageContractTestBase
{
    protected function createStorage(): void
    {
        @require_once LEAF_PHP_DIR . 'storage/GitStorage.php';
        $s = new GitStorage(DATA_ROOT, DELETED_NOTE_TTL_DAYS, STAGE_FLUSH_HOURS);
        $GLOBALS['testStorage'] = $s;
        storage_set($s);
    }

    // ═══════════════════════════════════════════════════════════════
    // Git-specific tests
    // ═══════════════════════════════════════════════════════════════

    #[Test]
    public function git_e2eeSupport_returnsFalse(): void
    {
        $this->assertFalse(storage()->e2eeSupport());
    }

    #[Test]
    public function git_markVersionSeen_isNoop(): void
    {
        [$v1] = storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');
        storage()->markVersionSeen('note', 2);

        // Calling markVersionSeen must not change the note's state
        $note = storage()->getNoteFull('note', 1);
        $this->assertSame($v1, $note['version']);
        $this->assertSame('content', $note['content']);
    }

    #[Test]
    public function git_pathConversion_colonBecomesSlash(): void
    {
        // Create a note with colons in the ID → should create real directories
        storage()->putNoteLogged('work:meetings:standup', '## Standup Notes', 'alice', 1, 'local');

        $note = storage()->getNoteFull('work:meetings:standup', 1);
        $this->assertSame('## Standup Notes', $note['content']);

        // Verify the file exists at the hierarchical path
        $this->assertTrue(file_exists(NOTES_DIR . 'work/meetings/standup.md'));

        // The note is in listNotes
        $list = storage()->listNotes();
        $ids = array_column($list, 'id');
        $this->assertContains('work:meetings:standup', $ids);
    }

    #[Test]
    public function git_pathTraversal_blocked(): void
    {
        // Attempting to use ".." in a note ID should be blocked
        // safe_id() in sync.php would prevent this, but we test
        // that noteFsPath rejects it at the storage level.

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Path traversal');

        // Call note_deleted to trigger noteFsPath with a traversal attempt
        // Using a private method via reflection is messy, so we use
        // putNoteLogged which internally calls noteFsPath via notePath
        storage()->putNoteLogged('..:etc:passwd', 'malicious', 'alice', 1, 'local');
    }

    #[Test]
    public function git_versionList_returnsShasAsKeys(): void
    {
        [$v1] = storage()->putNoteLogged('note', 'v1', 'alice', 1, 'local');
        [$v2] = storage()->putNoteLogged('note', 'v2', 'bob', 2, $v1);

        $versions = storage()->getVersionList('note');
        $this->assertCount(2, $versions);

        // Version keys are composite: "{sha}\x00{path}". Verify SHA prefix.
        foreach ($versions as $v) {
            $sep = strpos($v['key'], "\x00");
            $shaPart = $sep !== false ? substr($v['key'], 0, $sep) : $v['key'];
            $this->assertMatchesRegularExpression('/^[a-f0-9]{40}$/', $shaPart,
                'Version key should contain a 40-char git SHA');
        }

        // Newest first (keys are composite: sha\x00path)
        $this->assertStringStartsWith($v2, $versions[0]['key']);
        $this->assertStringStartsWith($v1, $versions[1]['key']);
    }

    #[Test]
    public function git_getVersionContent_retrievesBySha(): void
    {
        [$v1] = storage()->putNoteLogged('note', '# Alice v1', 'alice', 1, 'local');
        [$v2] = storage()->putNoteLogged('note', '# Bob v2', 'bob', 2, $v1);

        $this->assertSame('# Alice v1', storage()->getVersionContent('note', $v1));
        $this->assertSame('# Bob v2',   storage()->getVersionContent('note', $v2));

        // Unknown SHA returns null
        $this->assertNull(storage()->getVersionContent('note', str_repeat('0', 40)));
    }

    #[Test]
    public function git_tombstone_returnsContentFromGitHistory(): void
    {
        storage()->putNoteLogged('note', 'pre-delete content', 'alice', 1, 'local');
        storage()->deleteNoteLogged('note', 'bob');

        $tomb = storage()->getTombstone('note');
        $this->assertNotNull($tomb);
        $this->assertSame('pre-delete content', $tomb['content']);
        $this->assertSame('bob', $tomb['deleted_by']);
        $this->assertNotEmpty($tomb['version']);
    }

    #[Test]
    public function git_revive_restoresContentFromGitHistory(): void
    {
        storage()->putNoteLogged('note', 'to-be-revived', 'alice', 1, 'local');
        storage()->deleteNoteLogged('note', 'alice');

        $this->assertTrue(storage()->noteDeleted('note'));
        storage()->reviveNote('note');
        $this->assertFalse(storage()->noteDeleted('note'));

        $note = storage()->getNoteFull('note', 1);
        $this->assertSame('to-be-revived', $note['content']);
    }

    #[Test]
    public function git_createdBy_fromFirstCommitAuthor(): void
    {
        [$v1] = storage()->putNoteLogged('note', 'original', 'creator-alice', 1, 'local');
        [$v2] = storage()->putNoteLogged('note', 'updated', 'editor-bob', 2, $v1);

        $note = storage()->getNoteFull('note', 1);
        $this->assertSame('creator-alice', $note['created_by'],
            'created_by must survive updates');
        $this->assertSame('editor-bob', $note['author'],
            'author should be the latest editor');
    }

    #[Test]
    public function git_changelog_versionFieldIsSha(): void
    {
        [$v1] = storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');

        // changelogSince(1) skips the SYSTEM_INIT bootstrap marker (rev=1)
        $entries = storage()->changelogSince(1);
        $this->assertCount(1, $entries);

        $entry = $entries[0];
        $this->assertSame('CREATE', $entry['type']);
        $this->assertSame('note', $entry['file']);

        // Version field is a git SHA, not a composite key
        $this->assertMatchesRegularExpression('/^[a-f0-9]{40}$/', $entry['version'],
            'Changelog version should be a 40-char git SHA');
    }

    #[Test]
    public function git_deleteThenReviveThenDeleteAgain(): void
    {
        storage()->putNoteLogged('note', 'cycle test', 'alice', 1, 'local');

        // First delete
        storage()->deleteNoteLogged('note', 'alice');
        $this->assertTrue(storage()->noteDeleted('note'));

        // Revive via new write
        storage()->putNoteLogged('note', 'revived via write', 'bob', 2, 'local');
        $this->assertFalse(storage()->noteDeleted('note'));

        // Second delete
        storage()->deleteNoteLogged('note', 'charlie');
        $this->assertTrue(storage()->noteDeleted('note'));

        $tomb = storage()->getTombstone('note');
        $this->assertSame('revived via write', $tomb['content']);
        $this->assertSame('charlie', $tomb['deleted_by']);
    }

    #[Test]
    public function git_hardDelete_removesTombstoneMarker(): void
    {
        storage()->putNoteLogged('note', 'gone', 'alice', 1, 'local');
        storage()->deleteNoteLogged('note', 'alice');
        $this->assertTrue(storage()->noteDeleted('note'));

        storage()->hardDeleteNote('note');
        $this->assertFalse(storage()->noteDeleted('note'));
        $this->assertNull(storage()->getTombstone('note'));
    }

    #[Test]
    public function git_housekeeping_flushesAllStages(): void
    {
        // housekeeping('sync') should return an int and not throw
        $result = storage()->housekeeping('sync');
        $this->assertIsInt($result);
    }

    #[Test]
    public function git_renameNote_preservesVersionHistory(): void
    {
        [$v1] = storage()->putNoteLogged('note', 'original', 'alice', 1, 'local');
        [$v2] = storage()->putNoteLogged('note', 'updated', 'bob', 2, $v1);

        storage()->renameNoteLogged('note', 'moved', 'charlie');

        // The renamed note has the latest content
        $note = storage()->getNoteFull('moved', 1);
        $this->assertSame('updated', $note['content']);
        $this->assertSame('alice', $note['created_by']);

        // Version history preserved (at least 2 versions)
        $versions = storage()->getVersionList('moved');
        $this->assertGreaterThanOrEqual(2, count($versions));

        // Old ID is gone
        $this->assertNull(storage()->getNoteFull('note', 1));
    }

    #[Test]
    public function git_listNotes_sortedById(): void
    {
        storage()->putNoteLogged('c', 'c-content', 'alice', 1, 'local');
        storage()->putNoteLogged('a', 'a-content', 'alice', 1, 'local');
        storage()->putNoteLogged('b', 'b-content', 'alice', 1, 'local');

        $list = storage()->listNotes();
        $this->assertCount(3, $list);
        $this->assertSame('a', $list[0]['id']);
        $this->assertSame('b', $list[1]['id']);
        $this->assertSame('c', $list[2]['id']);
    }

    #[Test]
    public function git_listNotes_includesCreatedAndUpdatedAt(): void
    {
        storage()->putNoteLogged('note', 'content', 'alice', 1, 'local');

        $list = storage()->listNotes();
        $this->assertCount(1, $list);

        $meta = $list[0];
        $this->assertArrayHasKey('id', $meta);
        $this->assertArrayHasKey('created_at', $meta);
        $this->assertArrayHasKey('updated_at', $meta);
        $this->assertArrayHasKey('current', $meta);

        $this->assertGreaterThan(0, $meta['created_at']);
        $this->assertGreaterThan(0, $meta['updated_at']);
        $this->assertNotEmpty($meta['current']);
    }
}
