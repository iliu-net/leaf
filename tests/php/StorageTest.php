<?php
use PHPUnit\Framework\TestCase;

class StorageTest extends TestCase
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

    // ── note_path / deleted_path ──────────────────────────────────────────

    public function testNotePath(): void
    {
        $this->assertSame(NOTES_DIR . 'foo.json', note_path('foo'));
    }

    public function testDeletedPath(): void
    {
        $this->assertSame(NOTES_DIR . 'foo.deleted.json', deleted_path('foo'));
    }

    // ── note_is_deleted / storage_note_exists ──────────────────────────────

    public function testNoteDoesNotExistInitially(): void
    {
        $this->assertFalse(storage_note_exists('nonexistent'));
        $this->assertFalse(note_is_deleted('nonexistent'));
    }

    public function testNoteExistsAfterPut(): void
    {
        storage_put_note('foo', ['current' => null, 'created_at' => time(), 'versions' => []]);
        $this->assertTrue(storage_note_exists('foo'));
        $this->assertFalse(note_is_deleted('foo'));
    }

    public function testNoteIsDeletedAfterDelete(): void
    {
        storage_put_note('foo', ['current' => null, 'created_at' => time(), 'versions' => []]);
        storage_delete_note('foo');
        $this->assertFalse(storage_note_exists('foo'));
        $this->assertTrue(note_is_deleted('foo'));
    }

    public function testDeleteIsIdempotent(): void
    {
        storage_delete_note('nonexistent');
        $this->assertFalse(note_is_deleted('nonexistent'));
    }

    // ── storage_get_note ───────────────────────────────────────────────────

    public function testGetNoteReturnsData(): void
    {
        $data = ['current' => null, 'created_at' => 1000, 'versions' => []];
        storage_put_note('foo', $data);
        $this->assertSame($data, storage_get_note('foo'));
    }

    public function testGetNoteReturnsNullForDeleted(): void
    {
        storage_put_note('foo', ['current' => null, 'created_at' => time(), 'versions' => []]);
        storage_delete_note('foo');
        $this->assertNull(storage_get_note('foo'));
    }

    // ── storage_list_notes ─────────────────────────────────────────────────

    public function testListNotesReturnsEmptyInitially(): void
    {
        $this->assertSame([], storage_list_notes());
    }

    public function testListNotesIncludesOnlyLiveNotes(): void
    {
        storage_put_note('a', ['current' => null, 'created_at' => 1, 'versions' => []]);
        storage_put_note('b', ['current' => null, 'created_at' => 2, 'versions' => []]);
        storage_delete_note('b');
        $list = storage_list_notes();
        $this->assertCount(1, $list);
        $this->assertSame('a', $list[0]['id']);
    }

    // ── storage_resolve_version ────────────────────────────────────────────

    public function testResolveVersionFirstWrite(): void
    {
        $note = ['current' => null, 'created_at' => time(), 'versions' => []];
        [$vkey, $overwrite] = storage_resolve_version($note, 'alice');
        $this->assertStringStartsWith(gmdate('Y-m-d') . ':1:alice', $vkey);
        $this->assertFalse($overwrite);
    }

    public function testResolveVersionIncrementsCounter(): void
    {
        $today = gmdate('Y-m-d');
        $note  = [
            'current'    => "$today:1:alice",
            'created_at' => time(),
            'versions'   => ["$today:1:alice" => ['saved_at' => time(), 'content' => '', 'prev' => null, 'exclusive' => true]],
        ];
        [$vkey, $overwrite] = storage_resolve_version($note, 'alice');
        // Same date + same author but overwrite only if same version key
        $this->assertSame("$today:1:alice", $vkey);
        $this->assertTrue($overwrite);
    }

    public function testResolveVersionDifferentAuthorCreatesNew(): void
    {
        $today = gmdate('Y-m-d');
        $note  = [
            'current'    => "$today:1:alice",
            'created_at' => time(),
            'versions'   => ["$today:1:alice" => ['saved_at' => time(), 'content' => '', 'prev' => null]],
        ];
        [$vkey, $overwrite] = storage_resolve_version($note, 'bob');
        $this->assertSame("$today:1:bob", $vkey);
        $this->assertFalse($overwrite);
    }

    // ── storage_apply_write ────────────────────────────────────────────────

    public function testApplyWriteCreatesNote(): void
    {
        $vkey = storage_apply_write('new-note', 'hello world', 'alice');
        $note = storage_get_note('new-note');
        $this->assertNotNull($note);
        $this->assertSame($vkey, $note['current']);
        $this->assertSame('hello world', $note['versions'][$vkey]['content']);
    }

    public function testApplyWriteOverwritesSameAuthorSameDay(): void
    {
        storage_apply_write('note', 'v1', 'alice');
        $vkey2 = storage_apply_write('note', 'v2', 'alice');
        $note  = storage_get_note('note');
        $this->assertSame($vkey2, $note['current']);
        $this->assertCount(1, $note['versions'], 'Same author+day should overwrite');
    }

    // ── storage_rename_note ────────────────────────────────────────────────

    public function testRenameNote(): void
    {
        storage_apply_write('old-name', 'content', 'alice');
        $this->assertTrue(storage_rename_note('old-name', 'new-name'));
        $this->assertFalse(storage_note_exists('old-name'));
        $this->assertTrue(storage_note_exists('new-name'));
        $note = storage_get_note('new-name');
        $this->assertNotNull($note);
        $this->assertSame('content', $note['versions'][$note['current']]['content']);
    }

    public function testRenameNonexistentFails(): void
    {
        $this->assertFalse(storage_rename_note('nonexistent', 'new-name'));
    }

    public function testRenameToExistingFails(): void
    {
        storage_apply_write('source', 'content', 'alice');
        storage_apply_write('target', 'other', 'alice');
        $this->assertFalse(storage_rename_note('source', 'target'));
    }

    public function testRenameDeletedFails(): void
    {
        storage_apply_write('source', 'content', 'alice');
        storage_delete_note('source');
        $this->assertFalse(storage_rename_note('source', 'new-name'));
    }

    public function testRenameToDeletedFails(): void
    {
        storage_apply_write('source', 'content', 'alice');
        storage_apply_write('target', 'other', 'alice');
        storage_delete_note('target');
        $this->assertFalse(storage_rename_note('source', 'target'));
    }

    public function testRenamePreservesHistory(): void
    {
        storage_apply_write('note', 'v1', 'alice');
        storage_apply_write('note', 'v2', 'bob');
        storage_apply_write('note', 'v3', 'charlie');
        $this->assertTrue(storage_rename_note('note', 'renamed'));
        $note = storage_get_note('renamed');
        $this->assertNotNull($note);
        $this->assertCount(3, $note['versions']);
        $this->assertSame('v3', $note['versions'][$note['current']]['content']);
    }

    // ── storage_revive_note ─────────────────────────────────────────────────

    public function testReviveRemovesTombstone(): void
    {
        storage_apply_write('foo', 'content', 'alice');
        storage_delete_note('foo');
        $this->assertTrue(note_is_deleted('foo'));
        storage_revive_note('foo');
        $this->assertFalse(note_is_deleted('foo'));
    }

    public function testReviveIdempotentOnLiveNote(): void
    {
        storage_apply_write('foo', 'content', 'alice');
        storage_revive_note('foo');  // no tombstone — should no-op
        $this->assertTrue(storage_note_exists('foo'));
    }

    public function testReviveIdempotentOnNonexistent(): void
    {
        storage_revive_note('nonexistent');  // no tombstone — should no-op
        $this->assertFalse(storage_note_exists('nonexistent'));
    }

    public function testCreateAfterReviveWorks(): void
    {
        // Create, delete, revive, then create again
        storage_apply_write('foo', 'original', 'alice');
        storage_delete_note('foo');
        $this->assertNull(storage_get_note('foo'));

        storage_revive_note('foo');
        $this->assertFalse(note_is_deleted('foo'));

        // Now a fresh write should succeed
        storage_apply_write('foo', 'new content', 'bob');
        $note = storage_get_note('foo');
        $this->assertNotNull($note);
        $this->assertSame('new content', $note['versions'][$note['current']]['content']);
    }

    // ── Soft-delete maintenance ────────────────────────────────────────────

    public function testDeleteEmbedsDeletedAt(): void
    {
        storage_apply_write('foo', 'content', 'alice');
        $before = time();
        storage_delete_note('foo');
        $after = time();

        $tombstone = json_decode(file_get_contents(deleted_path('foo')), true);
        $this->assertIsArray($tombstone);
        $this->assertArrayHasKey('deleted_at', $tombstone);
        $this->assertGreaterThanOrEqual($before, $tombstone['deleted_at']);
        $this->assertLessThanOrEqual($after, $tombstone['deleted_at']);
    }

    public function testReviveRestoresFullContent(): void
    {
        // Create with two versions
        storage_apply_write('note', 'v1', 'alice');
        storage_apply_write('note', 'v2', 'bob');
        storage_delete_note('note');

        storage_revive_note('note');
        $note = storage_get_note('note');
        $this->assertNotNull($note);
        $this->assertCount(2, $note['versions']);
        $this->assertSame('v2', $note['versions'][$note['current']]['content']);
    }

    public function testHardDeleteNote(): void
    {
        storage_apply_write('foo', 'content', 'alice');
        storage_delete_note('foo');
        $this->assertTrue(note_is_deleted('foo'));

        storage_hard_delete_note('foo');
        $this->assertFalse(note_is_deleted('foo'));
        $this->assertFalse(file_exists(deleted_path('foo')));
    }

    public function testHardDeleteNoteIdempotent(): void
    {
        storage_hard_delete_note('nonexistent');
        $this->assertFalse(note_is_deleted('nonexistent'));
    }

    public function testListDeletedNotes(): void
    {
        storage_apply_write('a', 'content', 'alice');
        storage_apply_write('b', 'content', 'alice');
        storage_delete_note('a');
        storage_delete_note('b');

        $list = storage_list_deleted_notes();
        $this->assertCount(2, $list);
        // Sorted by id
        $this->assertSame('a', $list[0]['id']);
        $this->assertSame('b', $list[1]['id']);
        $this->assertNotNull($list[0]['deleted_at']);
        $this->assertNotNull($list[1]['deleted_at']);
    }

    public function testListDeletedNotesExcludesLiveNotes(): void
    {
        storage_apply_write('live', 'content', 'alice');
        storage_apply_write('dead', 'content', 'alice');
        storage_delete_note('dead');

        $list = storage_list_deleted_notes();
        $this->assertCount(1, $list);
        $this->assertSame('dead', $list[0]['id']);
    }

    public function testPurgeDeletedNotes(): void
    {
        storage_apply_write('old', 'content', 'alice');
        storage_delete_note('old');

        // Manually set deleted_at far in the past
        $path = deleted_path('old');
        $data = json_decode(file_get_contents($path), true);
        $data['deleted_at'] = time() - (DELETED_NOTE_TTL_DAYS + 1) * 86400;
        file_put_contents($path, json_encode($data));

        $removed = storage_purge_deleted_notes();
        $this->assertSame(1, $removed);
        $this->assertFalse(note_is_deleted('old'));
    }

    public function testPurgeDeletedNotesSkipsRecent(): void
    {
        storage_apply_write('recent', 'content', 'alice');
        storage_delete_note('recent');

        // deleted_at is now (within TTL)
        $removed = storage_purge_deleted_notes();
        $this->assertSame(0, $removed);
        $this->assertTrue(note_is_deleted('recent'));
    }

    public function testPurgeDeletedNotesSkipsLegacyTombstone(): void
    {
        storage_apply_write('legacy', 'content', 'alice');
        storage_delete_note('legacy');

        // Remove deleted_at to simulate a legacy tombstone
        $path = deleted_path('legacy');
        $data = json_decode(file_get_contents($path), true);
        unset($data['deleted_at']);
        file_put_contents($path, json_encode($data));

        $removed = storage_purge_deleted_notes();
        $this->assertSame(0, $removed, 'Legacy tombstones without deleted_at must not be purged');
        $this->assertTrue(note_is_deleted('legacy'));
    }

    // ── Changelog ──────────────────────────────────────────────────────────

    public function testChangelogAppendAndQuery(): void
    {
        changelog_append(['rev' => 1, 'file' => 'a', 'type' => 'CREATE', 'ts' => 100, 'version' => null, 'prev_version' => null]);
        changelog_append(['rev' => 2, 'file' => 'a', 'type' => 'UPDATE', 'ts' => 200, 'version' => 'v2', 'prev_version' => null]);
        changelog_append(['rev' => 3, 'file' => 'b', 'type' => 'CREATE', 'ts' => 300, 'version' => null, 'prev_version' => null]);

        $entries = changelog_since(1);
        $this->assertCount(2, $entries);
        $this->assertSame(2, $entries[0]['rev']);
        $this->assertSame(3, $entries[1]['rev']);
    }

    public function testChangelogCurrentRev(): void
    {
        $this->assertSame(0, changelog_current_rev());
        changelog_append(['rev' => 5, 'file' => 'a', 'type' => 'CREATE', 'ts' => 100, 'version' => null, 'prev_version' => null]);
        $this->assertSame(5, changelog_current_rev());
    }

    public function testNextRev(): void
    {
        $this->assertSame(1, next_rev());
        changelog_append(['rev' => 1, 'file' => 'a', 'type' => 'CREATE', 'ts' => 100, 'version' => null, 'prev_version' => null]);
        $this->assertSame(2, next_rev());
        changelog_append(['rev' => 2, 'file' => 'a', 'type' => 'UPDATE', 'ts' => 200, 'version' => null, 'prev_version' => null]);
        $this->assertSame(3, next_rev());
    }
}
