<?php
use PHPUnit\Framework\TestCase;

class StorageTest extends TestCase
{
    private string $notesDir;

    protected function setUp(): void
    {
        // Always use FlatFileStorage for internal tests
        @require_once LEAF_PHP_DIR . 'storage/FlatFileStorage.php';
        $s = new FlatFileStorage(DATA_ROOT, DELETED_NOTE_TTL_DAYS);
        $GLOBALS['testStorage'] = $s;
        storage_set($s);

        $this->notesDir = NOTES_DIR;
        $this->cleanNotesDir();
    }

    protected function tearDown(): void
    {
        $this->cleanNotesDir();
        if (file_exists(CHANGELOG_FILE)) unlink(CHANGELOG_FILE);
    }

    private function cleanNotesDir(): void
    {
        foreach (glob($this->notesDir . '*') ?: [] as $f) {
            if (file_exists($f)) unlink($f);
        }
    }

    // ── storage_note_deleted / storage_note_exists ──────────────────────────────

    public function testNoteDoesNotExistInitially(): void
    {
        $this->assertFalse(storage_invoke('noteExists','nonexistent'));
        $this->assertFalse(storage()->noteDeleted('nonexistent'));
    }

    public function testNoteExistsAfterPut(): void
    {
        storage_invoke('putNote','foo', ['current' => null, 'created_at' => time(), 'versions' => []]);
        $this->assertTrue(storage_invoke('noteExists','foo'));
        $this->assertFalse(storage()->noteDeleted('foo'));
    }

    public function testNoteIsDeletedAfterDelete(): void
    {
        storage_invoke('putNote','foo', ['current' => null, 'created_at' => time(), 'versions' => []]);
        storage_invoke('deleteNote','foo', 'testuser');
        $this->assertFalse(storage_invoke('noteExists','foo'));
        $this->assertTrue(storage()->noteDeleted('foo'));
    }

    public function testDeleteIsIdempotent(): void
    {
        storage_invoke('deleteNote','nonexistent', 'testuser');
        $this->assertFalse(storage()->noteDeleted('nonexistent'));
    }

    // ── storage_get_note ───────────────────────────────────────────────────

    public function testGetNoteReturnsData(): void
    {
        $data = ['current' => null, 'created_at' => 1000, 'versions' => []];
        storage_invoke('putNote','foo', $data);
        $this->assertSame($data, storage()->getNote('foo'));
    }

    public function testGetNoteReturnsNullForDeleted(): void
    {
        storage_invoke('putNote','foo', ['current' => null, 'created_at' => time(), 'versions' => []]);
        storage_invoke('deleteNote','foo', 'testuser');
        $this->assertNull(storage()->getNote('foo'));
    }

    // ── storage_list_notes ─────────────────────────────────────────────────

    public function testListNotesReturnsEmptyInitially(): void
    {
        $this->assertSame([], storage()->listNotes());
    }

    public function testListNotesIncludesOnlyLiveNotes(): void
    {
        storage_invoke('putNote','a', ['current' => null, 'created_at' => 1, 'versions' => []]);
        storage_invoke('putNote','b', ['current' => null, 'created_at' => 2, 'versions' => []]);
        storage_invoke('deleteNote','b', 'testuser');
        $list = storage()->listNotes();
        $this->assertCount(1, $list);
        $this->assertSame('a', $list[0]['id']);
    }

    // ── storage_resolve_version ────────────────────────────────────────────

    public function testResolveVersionFirstWrite(): void
    {
        $note = ['current' => null, 'created_at' => time(), 'versions' => []];
        [$vkey, $overwrite] = storage_invoke('resolveVersion',$note, 1);
        $this->assertStringStartsWith(gmdate('Y-m-d') . ':0:1', $vkey);
        $this->assertFalse($overwrite);
    }

    public function testResolveVersionOverwritesSameClient(): void
    {
        $today = gmdate('Y-m-d');
        $note  = [
            'current'    => "$today:0:1",
            'created_at' => time(),
            'versions'   => ["$today:0:1" => ['author' => 'alice', 'saved_at' => time(), 'content' => '', 'prev' => null, 'exclusive' => true]],
        ];
        [$vkey, $overwrite] = storage_invoke('resolveVersion',$note, 1);
        // Same date + same client_id + exclusive → overwrite same key
        $this->assertSame("$today:0:1", $vkey);
        $this->assertTrue($overwrite);
    }

    public function testResolveVersionDifferentClientCreatesNew(): void
    {
        $today = gmdate('Y-m-d');
        $note  = [
            'current'    => "$today:0:1",
            'created_at' => time(),
            'versions'   => ["$today:0:1" => ['saved_at' => time(), 'content' => '', 'prev' => null]],
        ];
        [$vkey, $overwrite] = storage_invoke('resolveVersion',$note, 2);
        $this->assertSame("$today:0:2", $vkey);
        $this->assertFalse($overwrite);
    }

    // ── storage_apply_write ────────────────────────────────────────────────

    public function testApplyWriteCreatesNote(): void
    {
        $vkey = storage_invoke('applyWrite','new-note', 'hello world', 'alice', 1);
        $note = storage()->getNote('new-note');
        $this->assertNotNull($note);
        $this->assertSame($vkey, $note['current']);
        $this->assertSame('hello world', $note['versions'][$vkey]['content']);
    }

    public function testApplyWriteOverwritesSameClientSameDay(): void
    {
        storage_invoke('applyWrite','note', 'v1', 'alice', 1);
        $vkey2 = storage_invoke('applyWrite','note', 'v2', 'alice', 1);
        $note  = storage()->getNote('note');
        $this->assertSame($vkey2, $note['current']);
        $this->assertCount(1, $note['versions'], 'Same client+day should overwrite');
    }

    // ── storage_rename_note ────────────────────────────────────────────────

    public function testRenameNote(): void
    {
        storage_invoke('applyWrite','old-name', 'content', 'alice', 1);
        $this->assertTrue(storage_invoke('renameNote','old-name', 'new-name'));
        $this->assertFalse(storage_invoke('noteExists','old-name'));
        $this->assertTrue(storage_invoke('noteExists','new-name'));
        $note = storage()->getNote('new-name');
        $this->assertNotNull($note);
        $this->assertSame('content', $note['versions'][$note['current']]['content']);
    }

    public function testRenameNonexistentFails(): void
    {
        $this->assertFalse(storage_invoke('renameNote','nonexistent', 'new-name'));
    }

    public function testRenameToExistingFails(): void
    {
        storage_invoke('applyWrite','source', 'content', 'alice', 1);
        storage_invoke('applyWrite','target', 'other', 'alice', 1);
        $this->assertFalse(storage_invoke('renameNote','source', 'target'));
    }

    public function testRenameDeletedFails(): void
    {
        storage_invoke('applyWrite','source', 'content', 'alice', 1);
        storage_invoke('deleteNote','source', 'testuser');
        $this->assertFalse(storage_invoke('renameNote','source', 'new-name'));
    }

    public function testRenameToDeletedFails(): void
    {
        storage_invoke('applyWrite','source', 'content', 'alice', 1);
        storage_invoke('applyWrite','target', 'other', 'alice', 1);
        storage_invoke('deleteNote','target', 'testuser');
        $this->assertFalse(storage_invoke('renameNote','source', 'target'));
    }

    public function testRenamePreservesHistory(): void
    {
        storage_invoke('applyWrite','note', 'v1', 'alice', 1);
        storage_invoke('applyWrite','note', 'v2', 'bob', 2);
        storage_invoke('applyWrite','note', 'v3', 'charlie', 3);
        $this->assertTrue(storage_invoke('renameNote','note', 'renamed'));
        $note = storage()->getNote('renamed');
        $this->assertNotNull($note);
        $this->assertCount(3, $note['versions']);
        $this->assertSame('v3', $note['versions'][$note['current']]['content']);
    }

    // ── storage_revive_note ─────────────────────────────────────────────────

    public function testReviveRemovesTombstone(): void
    {
        storage_invoke('applyWrite','foo', 'content', 'alice', 1);
        storage_invoke('deleteNote','foo', 'testuser');
        $this->assertTrue(storage()->noteDeleted('foo'));
        storage()->reviveNote('foo');
        $this->assertFalse(storage()->noteDeleted('foo'));
    }

    public function testReviveIdempotentOnLiveNote(): void
    {
        storage_invoke('applyWrite','foo', 'content', 'alice', 1);
        storage()->reviveNote('foo');  // no tombstone — should no-op
        $this->assertTrue(storage_invoke('noteExists','foo'));
    }

    public function testReviveIdempotentOnNonexistent(): void
    {
        storage()->reviveNote('nonexistent');  // no tombstone — should no-op
        $this->assertFalse(storage_invoke('noteExists','nonexistent'));
    }

    public function testCreateAfterReviveWorks(): void
    {
        // Create, delete, revive, then create again
        storage_invoke('applyWrite','foo', 'original', 'alice', 1);
        storage_invoke('deleteNote','foo', 'testuser');
        $this->assertNull(storage()->getNote('foo'));

        storage()->reviveNote('foo');
        $this->assertFalse(storage()->noteDeleted('foo'));

        // Now a fresh write should succeed
        storage_invoke('applyWrite','foo', 'new content', 'bob', 2);
        $note = storage()->getNote('foo');
        $this->assertNotNull($note);
        $this->assertSame('new content', $note['versions'][$note['current']]['content']);
    }

    // ── Soft-delete maintenance ────────────────────────────────────────────

    public function testDeleteEmbedsDeletedAt(): void
    {
        storage_invoke('applyWrite','foo', 'content', 'alice', 1);
        $before = time();
        storage_invoke('deleteNote','foo', 'testuser');
        $after = time();

        $tombstone = json_decode(file_get_contents(NOTES_DIR . 'foo.deleted.json'), true);
        $this->assertIsArray($tombstone);
        $this->assertArrayHasKey('deleted_at', $tombstone);
        $this->assertGreaterThanOrEqual($before, $tombstone['deleted_at']);
        $this->assertLessThanOrEqual($after, $tombstone['deleted_at']);
    }

    public function testReviveRestoresFullContent(): void
    {
        // Create with two versions
        storage_invoke('applyWrite','note', 'v1', 'alice', 1);
        storage_invoke('applyWrite','note', 'v2', 'bob', 2);
        storage_invoke('deleteNote','note', 'testuser');

        storage()->reviveNote('note');
        $note = storage()->getNote('note');
        $this->assertNotNull($note);
        $this->assertCount(2, $note['versions']);
        $this->assertSame('v2', $note['versions'][$note['current']]['content']);
    }

    public function testHardDeleteNote(): void
    {
        storage_invoke('applyWrite','foo', 'content', 'alice', 1);
        storage_invoke('deleteNote','foo', 'testuser');
        $this->assertTrue(storage()->noteDeleted('foo'));

        storage()->hardDeleteNote('foo');
        $this->assertFalse(storage()->noteDeleted('foo'));
        $this->assertFalse(file_exists(NOTES_DIR . 'foo.deleted.json'));
    }

    public function testHardDeleteNoteIdempotent(): void
    {
        storage()->hardDeleteNote('nonexistent');
        $this->assertFalse(storage()->noteDeleted('nonexistent'));
    }

    public function testListDeletedNotes(): void
    {
        storage_invoke('applyWrite','a', 'content', 'alice', 1);
        storage_invoke('applyWrite','b', 'content', 'alice', 1);
        storage_invoke('deleteNote','a', 'testuser');
        storage_invoke('deleteNote','b', 'testuser');

        $list = storage()->listDeletedNotes();
        $this->assertCount(2, $list);
        // Sorted by id
        $this->assertSame('a', $list[0]['id']);
        $this->assertSame('b', $list[1]['id']);
        $this->assertNotNull($list[0]['deleted_at']);
        $this->assertNotNull($list[1]['deleted_at']);
    }

    public function testListDeletedNotesExcludesLiveNotes(): void
    {
        storage_invoke('applyWrite','live', 'content', 'alice', 1);
        storage_invoke('applyWrite','dead', 'content', 'alice', 1);
        storage_invoke('deleteNote','dead', 'testuser');

        $list = storage()->listDeletedNotes();
        $this->assertCount(1, $list);
        $this->assertSame('dead', $list[0]['id']);
    }

    public function testPurgeDeletedNotes(): void
    {
        storage_invoke('applyWrite','old', 'content', 'alice', 1);
        storage_invoke('deleteNote','old', 'testuser');

        // Manually set deleted_at far in the past
        $path = NOTES_DIR . 'old.deleted.json';
        $data = json_decode(file_get_contents($path), true);
        $data['deleted_at'] = time() - (DELETED_NOTE_TTL_DAYS + 1) * 86400;
        file_put_contents($path, json_encode($data));

        $removed = storage_invoke('purgeDeletedNotes',);
        $this->assertSame(1, $removed);
        $this->assertFalse(storage()->noteDeleted('old'));
    }

    public function testPurgeDeletedNotesSkipsRecent(): void
    {
        storage_invoke('applyWrite','recent', 'content', 'alice', 1);
        storage_invoke('deleteNote','recent', 'testuser');

        // deleted_at is now (within TTL)
        $removed = storage_invoke('purgeDeletedNotes',);
        $this->assertSame(0, $removed);
        $this->assertTrue(storage()->noteDeleted('recent'));
    }

    public function testPurgeDeletedNotesSkipsLegacyTombstone(): void
    {
        storage_invoke('applyWrite','legacy', 'content', 'alice', 1);
        storage_invoke('deleteNote','legacy', 'testuser');

        // Remove deleted_at to simulate a legacy tombstone
        $path = NOTES_DIR . 'legacy.deleted.json';
        $data = json_decode(file_get_contents($path), true);
        unset($data['deleted_at']);
        file_put_contents($path, json_encode($data));

        $removed = storage_invoke('purgeDeletedNotes',);
        $this->assertSame(0, $removed, 'Legacy tombstones without deleted_at must not be purged');
        $this->assertTrue(storage()->noteDeleted('legacy'));
    }

    // ── Changelog ──────────────────────────────────────────────────────────

    public function testChangelogAppendAndQuery(): void
    {
        storage()->changelogAppend(['rev' => 1, 'file' => 'a', 'type' => 'CREATE', 'ts' => 100, 'version' => null, 'prev_version' => null]);
        storage()->changelogAppend(['rev' => 2, 'file' => 'a', 'type' => 'UPDATE', 'ts' => 200, 'version' => 'v2', 'prev_version' => null]);
        storage()->changelogAppend(['rev' => 3, 'file' => 'b', 'type' => 'CREATE', 'ts' => 300, 'version' => null, 'prev_version' => null]);

        $entries = storage()->changelogSince(1);
        $this->assertCount(2, $entries);
        $this->assertSame(2, $entries[0]['rev']);
        $this->assertSame(3, $entries[1]['rev']);
    }

    public function testChangelogCurrentRev(): void
    {
        $this->assertSame(0, storage()->changelogCurrentRev());
        storage()->changelogAppend(['rev' => 5, 'file' => 'a', 'type' => 'CREATE', 'ts' => 100, 'version' => null, 'prev_version' => null]);
        $this->assertSame(5, storage()->changelogCurrentRev());
    }

    public function testNextRev(): void
    {
        $this->assertSame(1, storage()->changelogNextRev());
        storage()->changelogAppend(['rev' => 1, 'file' => 'a', 'type' => 'CREATE', 'ts' => 100, 'version' => null, 'prev_version' => null]);
        $this->assertSame(2, storage()->changelogNextRev());
        storage()->changelogAppend(['rev' => 2, 'file' => 'a', 'type' => 'UPDATE', 'ts' => 200, 'version' => null, 'prev_version' => null]);
        $this->assertSame(3, storage()->changelogNextRev());
    }
}
