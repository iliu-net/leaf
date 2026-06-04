<?php
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

require_once LEAF_PHP_DIR . 'storage.php';
require_once LEAF_PHP_DIR . 'storage/GitStorage.php';

/**
 * GitStagingTest — exercises the write-ahead staging (.meta) system.
 *
 * Uses STAGE_FLUSH_HOURS > 0 so writes are staged, not immediately
 * committed.  Verifies debounce, read-side flush, cross-client flush,
 * date-change flush, and the DELETE/RENAME trigger behaviour.
 */
class GitStagingTest extends TestCase
{
    private GitStorage $storage;
    private string $dataRoot;

    protected function setUp(): void
    {
        // Each test gets a fresh repo with non-zero stage TTL
        $this->dataRoot = sys_get_temp_dir() . '/leaf-staging-' . getmypid() . '-' . uniqid();
        @mkdir($this->dataRoot, 0755, true);

        $this->storage = new GitStorage($this->dataRoot, 30, stageFlushHours: 12);
    }

    protected function tearDown(): void
    {
        // Recursively remove
        $this->rmTree($this->dataRoot);
    }

    private function rmTree(string $dir): void
    {
        if (!is_dir($dir)) return;
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dir, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($it as $f) {
            if ($f->isDir()) rmdir($f->getPathname()); else unlink($f->getPathname());
        }
        rmdir($dir);
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /** Check whether a .meta file exists on disk for a note. */
    private function hasMeta(string $id): bool
    {
        $ref = new ReflectionMethod($this->storage, 'metaPath');
        return file_exists($ref->invoke($this->storage, $id));
    }

    /** Check whether a .md file exists on disk for a note. */
    private function hasMd(string $id): bool
    {
        $ref = new ReflectionMethod($this->storage, 'notePath');
        return file_exists($ref->invoke($this->storage, $id));
    }

    /** Call storageFlushStage on a note (private method). */
    private function flushStage(string $id): string
    {
        $ref = new ReflectionMethod($this->storage, 'storageFlushStage');
        return $ref->invoke($this->storage, $id);
    }

    // ── Basic staging ───────────────────────────────────────────────

    #[Test]
    public function firstWrite_createsMetaFile(): void
    {
        $result = $this->storage->putNoteLogged('note', 'hello', 'alice', 1, 'local');

        // Staged — no commit yet
        $this->assertSame([null, true], $result);
        $this->assertTrue($this->hasMeta('note'));
        $this->assertTrue($this->hasMd('note'));
    }

    #[Test]
    public function stagedNote_isNotInVersionList(): void
    {
        $this->storage->putNoteLogged('note', 'hello', 'alice', 1, 'local');

        // No git commit yet → version list is empty
        $versions = $this->storage->getVersionList('note');
        $this->assertCount(0, $versions);
    }

    #[Test]
    public function stagedNote_contentIsReadableByAuthor(): void
    {
        $this->storage->putNoteLogged('note', 'staged content', 'alice', 1, 'local');

        // Author reads own note — sees the staged content
        $note = $this->storage->getNoteFull('note', 1);
        $this->assertSame('staged content', $note['content']);
        $this->assertSame('', $note['version'], 'No commit SHA until flushed');
    }

    // ── Debounce ─────────────────────────────────────────────────────

    #[Test]
    public function sameAuthorSameDay_overwritesStagedContent(): void
    {
        $this->storage->putNoteLogged('note', 'v1', 'alice', 1, 'local');
        $this->storage->putNoteLogged('note', 'v2', 'alice', 1, 'local');
        $this->storage->putNoteLogged('note', 'v3', 'alice', 1, 'local');

        // All three overwrote the same .md file — still staged
        $this->assertTrue($this->hasMeta('note'));

        // Content is the latest
        $note = $this->storage->getNoteFull('note', 1);
        $this->assertSame('v3', $note['content']);

        // No versions committed yet
        $versions = $this->storage->getVersionList('note');
        $this->assertCount(0, $versions);
    }

    #[Test]
    public function sameAuthorSameDay_producesSingleCommitAfterFlush(): void
    {
        $this->storage->putNoteLogged('note', 'v1', 'alice', 1, 'local');
        $this->storage->putNoteLogged('note', 'v2', 'alice', 1, 'local');
        $this->storage->putNoteLogged('note', 'v3', 'alice', 1, 'local');

        // Flush the stage
        $this->flushStage('note');

        // Now there's exactly one commit
        $versions = $this->storage->getVersionList('note');
        $this->assertCount(1, $versions, 'Debounced saves → one commit');

        $note = $this->storage->getNoteFull('note', 1);
        $this->assertSame('v3', $note['content']);
        $this->assertNotEmpty($note['version']);
    }

    // ── Read-side trigger ───────────────────────────────────────────

    #[Test]
    public function differentViewer_readTriggersFlush(): void
    {
        $this->storage->putNoteLogged('note', 'alice content', 'alice', 1, 'local');

        // Bob reads (different client_id) → triggers flush
        $note = $this->storage->getNoteFull('note', clientId: 2);

        // Content is committed now
        $this->assertSame('alice content', $note['content']);
        $this->assertNotEmpty($note['version'], 'Flush assigned a commit SHA');

        // .meta is gone
        $this->assertFalse($this->hasMeta('note'));

        // Version list now has one entry
        $versions = $this->storage->getVersionList('note');
        $this->assertCount(1, $versions);
    }

    #[Test]
    public function sameViewer_readDoesNotTriggerFlush(): void
    {
        $this->storage->putNoteLogged('note', 'my content', 'alice', 1, 'local');

        // Alice reads her own note — no flush
        $note = $this->storage->getNoteFull('note', clientId: 1);

        $this->assertSame('my content', $note['content']);
        $this->assertSame('', $note['version'], 'Still no commit');

        // .meta still exists
        $this->assertTrue($this->hasMeta('note'));
    }

    #[Test]
    public function clientIdZero_neverTriggersFlush(): void
    {
        $this->storage->putNoteLogged('note', 'content', 'alice', 1, 'local');

        // clientId=0 means "no viewer" — should never flush
        $note = $this->storage->getNoteFull('note', clientId: 0);

        $this->assertSame('', $note['version']);
        $this->assertTrue($this->hasMeta('note'));
    }

    // ── Write-side trigger ──────────────────────────────────────────

    #[Test]
    public function differentClient_writeFlushesOldStage(): void
    {
        // Alice stages content
        $this->storage->putNoteLogged('note', 'alice v1', 'alice', 1, 'local');

        // Bob writes — triggers flush of Alice's stage, then stages Bob's
        $result = $this->storage->putNoteLogged('note', 'bob v1', 'bob', 2, 'local');

        // Bob's write is staged (new .meta)
        $this->assertSame([null, true], $result);

        // Alice's content was committed (flush before Bob's write)
        $versions = $this->storage->getVersionList('note');
        $this->assertCount(1, $versions, 'Alice stage flushed → 1 commit');

        // Alice's content is in the version history
        $content = $this->storage->getVersionContent('note', $versions[0]['key']);
        $this->assertSame('alice v1', $content);

        // Bob's stage exists
        $this->assertTrue($this->hasMeta('note'));

        // Current read reflects Bob's staged content (author = Bob, viewer = Bob)
        $note = $this->storage->getNoteFull('note', 2);
        $this->assertSame('bob v1', $note['content']);
    }

    // ── DELETE flushes stage first ─────────────────────────────────

    #[Test]
    public function delete_flushesStagedContentFirst(): void
    {
        $this->storage->putNoteLogged('note', 'pre-delete staged', 'alice', 1, 'local');

        // Delete — should flush Alice's stage before deleting
        $ok = $this->storage->deleteNoteLogged('note', 'bob');
        $this->assertTrue($ok);

        // Note is deleted
        $this->assertTrue($this->storage->noteDeleted('note'));
        $this->assertNull($this->storage->getNoteFull('note', 1));

        // Tombstone has Alice's staged content
        $tomb = $this->storage->getTombstone('note');
        $this->assertNotNull($tomb);
        $this->assertSame('pre-delete staged', $tomb['content']);
        $this->assertSame('bob', $tomb['deleted_by']);
    }

    // ── RENAME flushes stage first ─────────────────────────────────

    #[Test]
    public function rename_flushesStagedContentFirst(): void
    {
        $this->storage->putNoteLogged('note', 'pre-rename staged', 'alice', 1, 'local');

        // Rename — should flush Alice's stage before renaming
        $ok = $this->storage->renameNoteLogged('note', 'moved', 'bob');
        $this->assertTrue($ok);

        // Content is under the new name
        $note = $this->storage->getNoteFull('moved', 1);
        $this->assertSame('pre-rename staged', $note['content']);
        $this->assertNotEmpty($note['version']);

        // Old name is gone
        $this->assertNull($this->storage->getNoteFull('note', 1));
    }

    // ── Housekeeping flushes stale stages ───────────────────────────

    #[Test]
    public function housekeeping_flushesStaleMetas(): void
    {
        $this->storage->putNoteLogged('a', 'content a', 'alice', 1, 'local');
        $this->storage->putNoteLogged('b', 'content b', 'bob', 2, 'local');

        $this->assertTrue($this->hasMeta('a'));
        $this->assertTrue($this->hasMeta('b'));

        // housekeeping('sync') flushes all stages
        $this->storage->housekeeping('sync');

        // Both stages flushed
        $this->assertFalse($this->hasMeta('a'));
        $this->assertFalse($this->hasMeta('b'));

        // Both notes have versions now
        $na = $this->storage->getNoteFull('a', 1);
        $nb = $this->storage->getNoteFull('b', 1);
        $this->assertNotEmpty($na['version']);
        $this->assertNotEmpty($nb['version']);
    }

    // ── putNoteLogged return value ──────────────────────────────────

    #[Test]
    public function putNoteLogged_returnsNullVersionWhenStaged(): void
    {
        $result = $this->storage->putNoteLogged('note', 'content', 'alice', 1, 'local');

        $this->assertIsArray($result);
        $this->assertCount(2, $result);
        $this->assertNull($result[0], 'Version is null — not committed yet');
        $this->assertTrue($result[1], 'Dirty flag is true — content is staged');
    }

    #[Test]
    public function putNoteLogged_returnsShaAfterFlush(): void
    {
        $this->storage->putNoteLogged('note', 'content', 'alice', 1, 'local');

        // Flush via cross-client read
        $this->storage->getNoteFull('note', clientId: 2);

        // Now the note is committed — a subsequent write is a new commit
        // (in test mode flushHours=0 the next write commits directly,
        //  but here with real staging it also commits because .meta was unlinked)
        $result = $this->storage->putNoteLogged('note', 'updated', 'alice', 1, 'local');
        $this->assertIsArray($result);
        // After flush, no .meta exists, so this write stages a fresh .meta
        $this->assertNull($result[0], 'First write after flush also stages');
        $this->assertTrue($result[1]);
    }

    // ── Existing git repo reuse ─────────────────────────────────────

    #[Test]
    public function existingRepo_isReused_noSecondGitDir(): void
    {
        // Simulate an existing project repo with a data/ subdirectory
        $projectRoot = $this->dataRoot . '/project';
        $dataDir     = $projectRoot . '/data';
        @mkdir($dataDir, 0755, true);

        // Create a git repo at the project root (not at data/), with an
        // initial commit so it resembles a real project repo.
        exec('git init ' . escapeshellarg($projectRoot), result_code: $rc);
        $this->assertSame(0, $rc);
        file_put_contents($projectRoot . '/.gitignore', '');
        exec('git -C ' . escapeshellarg($projectRoot) .
            ' add .gitignore', result_code: $rc);
        exec('git -C ' . escapeshellarg($projectRoot) .
            ' commit -m "Initial commit"', result_code: $rc);

        // Create GitStorage with dataRoot pointing at data/
        $gs = new GitStorage($dataDir, 30, stageFlushHours: 0);

        // No .git was created inside data/
        $this->assertFalse(is_dir($dataDir . '/.git'),
            'Should not create a new repo inside data/');

        // The existing project repo was used
        $this->assertTrue(is_dir($projectRoot . '/.git'),
            'Existing project repo still exists');

        // Write a note — it should work, committing to the parent repo
        [$sha] = $gs->putNoteLogged('note', 'content in existing repo', 'alice', 1, 'local');
        $this->assertNotEmpty($sha);

        // The note file exists at data/notes/note.md
        $this->assertTrue(file_exists($dataDir . '/notes/note.md'));

        // Git log from the project root sees the commit (with "data/" prefix).
        // The repo already has an initial commit from setup, so we check the
        // latest commit (HEAD).
        exec('git -C ' . escapeshellarg($projectRoot) . ' log -1 --oneline', $logOut, $rc);
        $this->assertCount(1, $logOut);
        $this->assertStringContainsString('CREATE note', $logOut[0]);

        // git show works with the data/ prefix path
        exec('git -C ' . escapeshellarg($projectRoot) . ' show HEAD:data/notes/note.md',
            $showOut, $rc);
        $this->assertSame(0, $rc);
        $this->assertSame('content in existing repo', implode("\n", $showOut));

        // Changelog is at data/changelog.jsonl
        $this->assertTrue(file_exists($dataDir . '/changelog.jsonl'));

        // Cleanup project repo too
        $this->rmTree($projectRoot);
    }

    #[Test]
    public function existingRepo_changelogIsCommittedWithPrefix(): void
    {
        $projectRoot = $this->dataRoot . '/project';
        $dataDir     = $projectRoot . '/data';
        @mkdir($dataDir, 0755, true);

        exec('git init ' . escapeshellarg($projectRoot), result_code: $rc);
        file_put_contents($projectRoot . '/.gitignore', '');
        exec('git -C ' . escapeshellarg($projectRoot) .
            ' add .gitignore', result_code: $rc);
        exec('git -C ' . escapeshellarg($projectRoot) .
            ' commit -m "Initial commit"', result_code: $rc);

        $gs = new GitStorage($dataDir, 30, stageFlushHours: 0);
        storage_set($gs);

        // First write → commit 1: notes/note-a.md (changelog doesn't exist yet)
        $gs->putNoteLogged('a', 'first note', 'alice', 1, 'local');

        // Second write → commit 2: notes/note-b.md + changelog from first write
        $gs->putNoteLogged('b', 'second note', 'alice', 1, 'local');

        // Changelog exists at data/changelog.jsonl on the working tree
        $this->assertTrue(file_exists($dataDir . '/changelog.jsonl'));

        // The last commit includes data/changelog.jsonl (trailing-commit model)
        exec('git -C ' . escapeshellarg($projectRoot) .
            ' show --name-only --format="" HEAD', $files, $rc);
        $this->assertContains('data/notes/b.md', $files);
        $this->assertContains('data/changelog.jsonl', $files,
            'Changelog is committed with the data/ prefix');

        // The working-tree changelog has full truth (including trailing entry)
        $entries = $gs->changelogSince(0);
        $this->assertCount(2, $entries);

        $this->rmTree($projectRoot);
    }

    #[Test]
    public function existingRepo_versionListUsesPrefixedPaths(): void
    {
        $projectRoot = $this->dataRoot . '/project';
        $dataDir     = $projectRoot . '/data';
        @mkdir($dataDir, 0755, true);

        exec('git init ' . escapeshellarg($projectRoot), result_code: $rc);
        file_put_contents($projectRoot . '/.gitignore', '');
        exec('git -C ' . escapeshellarg($projectRoot) .
            ' add .gitignore', result_code: $rc);
        exec('git -C ' . escapeshellarg($projectRoot) .
            ' commit -m "Initial commit"', result_code: $rc);

        $gs = new GitStorage($dataDir, 30, stageFlushHours: 0);
        storage_set($gs);

        [$v1] = $gs->putNoteLogged('note', 'v1', 'alice', 1, 'local');
        [$v2] = $gs->putNoteLogged('note', 'v2', 'bob', 2, $v1);

        // Version list works
        $versions = $gs->getVersionList('note');
        $this->assertCount(2, $versions);

        // Version content retrievable
        $this->assertSame('v1', $gs->getVersionContent('note', $v1));
        $this->assertSame('v2', $gs->getVersionContent('note', $v2));

        // getNoteFull returns metadata from the parent repo
        $note = $gs->getNoteFull('note', 1);
        $this->assertSame('v2', $note['content']);
        $this->assertSame('alice', $note['created_by']);
        $this->assertSame('bob', $note['author']);

        $this->rmTree($projectRoot);
    }
}
