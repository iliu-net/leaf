<?php
/**
 * GitStorage.php — git-backed storage backend
 *
 * Implements StorageInterface using a git repository:
 *   notes/{path}.md         — live note (markdown + YAML frontmatter)
 *   notes/{path}.meta       — write-ahead staging area (NOT committed)
 *   notes/{path}.deleted    — tombstone marker (NOT committed)
 *   changelog.jsonl         — append-only change log (IS committed, trails by 1 entry)
 *   .git/                   — git repository at DATA_ROOT
 *
 * Note IDs use colon (:) as a path separator.  This backend converts
 * colons to directory slashes, so "work:meetings:standup" lives at
 * notes/work/meetings/standup.md.  Path traversal is prevented by
 * sanitising each path segment.
 *
 * Key design decisions:
 *   - Commits are immutable (no version-overwrite edge cases).
 *   - Write-ahead staging (.meta files) debounces rapid same-device
 *     saves — git commits happen on flush triggers, not at write time.
 *   - The changelog is committed to git but always trails by one entry
 *     (the working-tree copy has the full truth).
 *   - .deleted markers carry deleted_at / deleted_by metadata that
 *     git doesn't natively store.
 *
 * See StorageInterface.php for the public API contract.
 */

require_once __DIR__ . '/StorageInterface.php';

class GitStorage implements StorageInterface
{
    // ── Constructor ────────────────────────────────────────────────────

    private readonly string $dataRoot;
    private readonly string $notesDir;
    private readonly string $changelogFile;
    private readonly string $gitLockFile;
    /** Git repo root — may differ from dataRoot if we reuse an existing repo. */
    private readonly string $gitRepoRoot;
    /** Prefix to prepend to git pathspecs (empty if repo IS dataRoot). */
    private readonly string $gitPathPrefix;
    /** @var int Stage TTL in hours (0 = always commit, never stage — used in tests) */
    private readonly int $stageFlushHours;

    /**
     * @param string $dataRoot           Path to the data/ directory
     * @param int    $deletedNoteTtlDays  Days before tombstones are permanently purged
     * @param int    $stageFlushHours     How long a .meta file can remain uncommitted
     *                                    before forced flush (0 = immediate commit, no staging)
     */
    public function __construct(
        string $dataRoot,
        private readonly int $deletedNoteTtlDays = 30,
        int $stageFlushHours = 12,
    ) {
        $dataRoot = rtrim($dataRoot, '/');
        $this->dataRoot       = $dataRoot;
        $this->notesDir       = $dataRoot . '/notes/';
        $this->changelogFile  = $dataRoot . '/changelog.jsonl';
        $this->gitLockFile    = $dataRoot . '/.git-lock';
        $this->stageFlushHours = $stageFlushHours;

        if (!is_dir($this->notesDir)) {
            mkdir($this->notesDir, 0755, true);
        }

        // Find or create the git repository
        $this->gitRepoRoot = $this->resolveGitRoot();

        // Compute prefix for git pathspecs relative to the repo root.
        // When repoRoot === dataRoot, prefix is empty (the common case).
        // When repoRoot is an ancestor, prefix is e.g. "data/" .
        $this->gitPathPrefix = ($this->gitRepoRoot === $this->dataRoot)
            ? ''
            : ltrim(substr($this->dataRoot, strlen($this->gitRepoRoot)), '/') . '/';

        // Verify
        exec('git -C ' . escapeshellarg($this->gitRepoRoot) . ' rev-parse --is-inside-work-tree',
            $output, $rc);
        if ($rc !== 0) {
            throw new \RuntimeException(
                'GitStorage: not inside a git work tree.  Check DATA_ROOT and git installation.'
            );
        }
    }

    /**
     * Find the git repository that contains DATA_ROOT.
     *
     * 1. DATA_ROOT/.git exists        → use DATA_ROOT
     * 2. An ancestor has .git         → use that ancestor
     * 3. Neither                      → git init at DATA_ROOT
     *
     * Walks up the directory tree checking for .git directories.
     * Also tries git rev-parse --show-toplevel for work trees where
     * .git is a file (submodules, linked work trees).
     *
     * @return string  Absolute path to the git repository root
     */
    private function resolveGitRoot(): string
    {
        // Walk up from DATA_ROOT, looking for a .git directory
        $dir = $this->dataRoot;
        while ($dir !== '/' && $dir !== '') {
            if (is_dir($dir . '/.git')) {
                return $dir;
            }
            // Also try git rev-parse for work trees with a .git file
            exec('git -C ' . escapeshellarg($dir) . ' rev-parse --show-toplevel 2>/dev/null',
                $output, $rc);
            if ($rc === 0 && !empty($output)) {
                return rtrim($output[0], '/');
            }
            $parent = dirname($dir);
            if ($parent === $dir) break;
            $dir = $parent;
        }

        // Not found — create a new repo at DATA_ROOT
        exec('git init ' . escapeshellarg($this->dataRoot), $output, $rc);
        if ($rc !== 0) {
            throw new \RuntimeException('GitStorage: git init failed');
        }

        // Set default identity for commits (overridden per-commit by --author)
        exec('git -C ' . escapeshellarg($this->dataRoot) .
            ' config user.email "git@leaf.local"', result_code: $rc);
        exec('git -C ' . escapeshellarg($this->dataRoot) .
            ' config user.name "Leaf"', result_code: $rc);

        // Create .gitignore to exclude staging and tombstone files from tracking
        $gitignore = $this->dataRoot . '/.gitignore';
        if (!file_exists($gitignore)) {
            file_put_contents($gitignore, "# Leaf git-storage exclusions\n*.meta\n*.deleted\n.git-lock\n");
        }

        // Create an initial empty commit so the repo always has a HEAD.
        exec('git -C ' . escapeshellarg($this->dataRoot) .
            ' add .gitignore', result_code: $rc);
        exec('git -C ' . escapeshellarg($this->dataRoot) .
            ' commit -m "Initial commit (Leaf git-storage)"', result_code: $rc);
        // Ignore failure — if commit fails, the repo is still usable.

        return $this->dataRoot;
    }

    // ── Path helpers ───────────────────────────────────────────────────

    /**
     * Convert a note ID (colon-separated) to a filesystem path within the
     * notes directory.  Each segment is sanitised to prevent path traversal.
     *
     * @return string  Full filesystem path to the note's .{ext} file
     */
    private function noteFsPath(string $id, string $ext): string
    {
        $parts = explode(':', $id);
        $segments = [];
        foreach ($parts as $part) {
            $part = trim($part);
            if ($part === '' || $part === '.') continue;
            if ($part === '..') {
                throw new \RuntimeException("Path traversal blocked for note id: {$id}");
            }
            $segments[] = $part;
        }
        $relative = implode('/', $segments) . '.' . $ext;
        $full = $this->notesDir . $relative;

        // Verify the resolved path stays within NOTES_DIR.
        // Walk up from the parent directory to find the first existing
        // ancestor, then verify the full path resolves inside NOTES_DIR.
        $notesReal = realpath($this->notesDir);
        if ($notesReal === false) {
            // NOTES_DIR doesn't exist yet — ensure dirname doesn't escape
            if (str_contains($relative, '..')) {
                throw new \RuntimeException("Path traversal blocked for note id: {$id}");
            }
            return $full;
        }
        $parent = dirname($full);
        // Walk up until we find an existing directory
        $existing = $parent;
        while ($existing !== '' && $existing !== '/' && !is_dir($existing)) {
            $existing = dirname($existing);
        }
        $real = realpath($existing);
        if ($real === false || !str_starts_with($real, $notesReal)) {
            throw new \RuntimeException("Path traversal blocked for note id: {$id}");
        }

        return $full;
    }

    /** Path to the .md file for a note. */
    private function notePath(string $id): string    { return $this->noteFsPath($id, 'md'); }
    /** Path to the .meta staging file. */
    private function metaPath(string $id): string    { return $this->noteFsPath($id, 'meta'); }
    /** Path to the .deleted tombstone marker. */
    private function deletedPath(string $id): string { return $this->noteFsPath($id, 'deleted'); }

    /**
     * Convert a note ID to a git pathspec (relative to repo root).
     * E.g. "work:meetings:standup" → "data/notes/work/meetings/standup.md"
     * (prefix is empty when the repo IS dataRoot).
     */
    private function gitPathspec(string $id, string $ext): string
    {
        $parts = array_filter(explode(':', $id), fn($p) => trim($p) !== '');
        return $this->gitPathPrefix . 'notes/' . implode('/', $parts) . '.' . $ext;
    }

    /**
     * Return the git pathspec for a note file (relative to repo root).
     * E.g. "work:meetings:standup" → "notes/work/meetings/standup.md"
     *
     * Callers pass this to gitExec(), which handles shell escaping.
     */
    private function gitPath(string $id, string $ext): string
    {
        return $this->gitPathspec($id, $ext);
    }

    // ── Git operations (private) ───────────────────────────────────────

    /**
     * Acquire the exclusive git lock.  MUST be paired with gitUnlock().
     *
     * @return resource  The lock file handle (pass to gitUnlock)
     */
    private function gitLock()
    {
        $lockDir = dirname($this->gitLockFile);
        if (!is_dir($lockDir)) mkdir($lockDir, 0755, true);
        $fh = fopen($this->gitLockFile, 'w');
        if (!$fh) throw new \RuntimeException('GitStorage: cannot open lock file');
        flock($fh, LOCK_EX);
        return $fh;
    }

    /** Release the git lock. */
    private function gitUnlock($fh): void
    {
        flock($fh, LOCK_UN);
        fclose($fh);
    }

    /**
     * Run a git command inside the repo.  Every argument is individually
     * shell-escaped, so callers should pass raw (unescaped) strings.
     *
     * @param string[] $args  Command arguments (e.g. ['add', 'notes/X.md'])
     * @param int|null $rc    Filled with the exit code
     * @return string[]       Output lines
     */
    private function gitExec(array $args, ?int &$rc = null): array
    {
        $cmd = 'git -C ' . escapeshellarg($this->gitRepoRoot);
        foreach ($args as $a) {
            $cmd .= ' ' . escapeshellarg($a);
        }
        exec($cmd, $output, $rc);
        return $output;
    }

    /**
     * Check whether changelog.jsonl has uncommitted (dirty) changes.
     * Used to decide whether to stage it alongside a note commit.
     */
    /**
     * Check whether changelog.jsonl needs to be committed.
     *
     * Two cases:
     *   1. The file is tracked and has uncommitted modifications (git diff).
     *   2. The file exists on disk but is not yet tracked (untracked new file).
     */
    private function changelogIsDirty(): bool
    {
        $path = $this->gitPathPrefix . 'changelog.jsonl';

        // Case 1: tracked file with modifications
        $this->gitExec(['diff', '--quiet', '--', $path], $rc);
        if ($rc !== 0) return true;

        // Case 2: file exists on disk but is not tracked.
        // git ls-files --cached returns empty output for untracked files
        // (quietly, no stderr noise unlike --error-unmatch).
        if (file_exists($this->changelogFile)) {
            $tracked = $this->gitExec(['ls-files', '--cached', '--', $path]);
            if (empty($tracked)) return true;   // untracked → needs staging
        }

        return false;
    }

    /**
     * Commit one or more files to git with an author-attributed message.
     *
     * Callers are responsible for filesystem I/O (write, unlink, rename)
     * BEFORE calling this method.  This method only stages and commits.
     *
     * If changelog.jsonl has uncommitted entries from a previous operation,
     * they are included in this commit (trailing-commit model).
     *
     * @param string[] $toAdd     File paths (git pathspecs) to git-add
     * @param string[] $toRemove  File paths to git-rm (may be empty)
     * @param string   $message   Commit message (e.g. "UPDATE my-note")
     * @param string   $author    Author username
     * @return string             The new commit SHA
     */
    private function gitCommit(
        array $toAdd,
        array $toRemove,
        string $message,
        string $author
    ): string {
        $lock = $this->gitLock();

        // Stage files to add
        foreach ($toAdd as $pathspec) {
            $this->gitExec(['add', '--', $pathspec], $rc);
            if ($rc !== 0) {
                $this->gitUnlock($lock);
                throw new \RuntimeException("GitStorage: git add failed for {$pathspec}");
            }
        }

        // Stage files to remove
        foreach ($toRemove as $pathspec) {
            $this->gitExec(['rm', '-f', '--', $pathspec], $rc);
            // git rm -f may still fail if file doesn't exist — that's OK
        }

        // Stage changelog if it has uncommitted entries from the previous operation
        if ($this->changelogIsDirty()) {
            $this->gitExec(['add', '--', $this->gitPathPrefix . 'changelog.jsonl'], $rc);
        }

        // Commit
        $authorArg = "{$author} <{$author}@leaf.local>";
        $this->gitExec(['commit', "--author={$authorArg}", "-m", $message], $rc);

        if ($rc !== 0) {
            $this->gitUnlock($lock);
            throw new \RuntimeException("GitStorage: git commit failed");
        }

        $sha = trim(implode('', $this->gitExec(['rev-parse', 'HEAD'])));
        $this->gitUnlock($lock);
        return $sha;
    }

    // ── Convenience wrappers around gitCommit ──────────────────────────

    /**
     * Write and commit a note's .md file (CREATE or UPDATE).
     *
     * Ensures parent directories exist, writes the file, then commits.
     */
    private function gitCommitMd(string $id, string $content, string $author, string $message): string
    {
        $fsPath = $this->notePath($id);
        $dir    = dirname($fsPath);
        if (!is_dir($dir)) mkdir($dir, 0755, true);
        file_put_contents($fsPath, $content);

        return $this->gitCommit(
            [$this->gitPathspec($id, 'md')],
            [],
            $message,
            $author
        );
    }

    /** Remove and commit a note's .md file (DELETE). */
    private function gitCommitDeleteMd(string $id, string $author, string $message): string
    {
        return $this->gitCommit(
            [],
            [$this->gitPathspec($id, 'md')],
            $message,
            $author
        );
    }

    /** Rename and commit a note's .md file (RENAME). */
    private function gitCommitRenameMd(string $oldId, string $newId, string $author, string $message): string
    {
        $oldPath = $this->notePath($oldId);
        $newPath = $this->notePath($newId);

        // Ensure target directory exists
        $newDir = dirname($newPath);
        if (!is_dir($newDir)) mkdir($newDir, 0755, true);

        // Use filesystem rename first (faster than git mv)
        if (file_exists($oldPath)) {
            rename($oldPath, $newPath);
        }

        return $this->gitCommit(
            [$this->gitPathspec($newId, 'md')],
            [$this->gitPathspec($oldId, 'md')],
            $message,
            $author
        );
    }

    // ── Git metadata queries (lock-free, read-only) ────────────────────

    /**
     * Get the last commit SHA that touched a note, or null if never committed.
     */
    private function gitLogLastSha(string $id): ?string
    {
        $path = $this->gitPath($id, 'md');
        $lines = $this->gitExec(['log', '--follow', '-1', '--format=%H', '--', $path], $rc);
        if ($rc !== 0 || empty($lines)) return null;
        $sha = trim($lines[0]);
        return $sha !== '' ? $sha : null;
    }

    /**
     * Get the parent of the latest commit for a note.
     */
    private function gitLogPrevSha(string $id): ?string
    {
        $path = $this->gitPath($id, 'md');
        $lines = $this->gitExec(['log', '--follow', '-2', '--format=%H', '--', $path], $rc);
        if ($rc !== 0 || count($lines) < 2) return null;
        $sha = trim($lines[1]);
        return $sha !== '' ? $sha : null;
    }

    /**
     * Return full metadata for a note from git history.
     *
     * - created_at / created_by  → first commit that added the file
     * - updated_at / author / sha → latest commit touching the file
     * - prev_sha                 → parent of the latest commit
     *
     * @return array{sha: ?string, created_at: int, created_by: string,
     *               updated_at: int, author: string, prev_sha: ?string}
     */
    private function gitFileInfo(string $id): array
    {
        $path = $this->gitPath($id, 'md');

        // Latest commit (follow renames)
        $latest = $this->gitExec(['log', '--follow', '-1', '--format=%H %at %an', '--', $path], $rc);
        $sha = null; $updatedAt = 0; $author = '';
        if (!empty($latest)) {
            $parts = explode(' ', trim($latest[0]), 3);
            $sha       = $parts[0] ?? null;
            $updatedAt = isset($parts[1]) ? (int)$parts[1] : 0;
            $author    = $parts[2] ?? '';
        }

        // First commit (creation, follow renames)
        $created = $this->gitExec(
            ['log', '--follow', '--diff-filter=A', '--format=%H %at %an', '--', $path], $rc);
        $createdAt = $updatedAt; $createdBy = $author;
        if (!empty($created)) {
            $lastLine = end($created);
            $parts = explode(' ', trim($lastLine), 3);
            $createdAt = isset($parts[1]) ? (int)$parts[1] : $createdAt;
            $createdBy = $parts[2] ?? $createdBy;
        }

        // Previous commit (parent of latest)
        $prevSha = $this->gitLogPrevSha($id);

        return [
            'sha'        => $sha,
            'created_at' => $createdAt,
            'created_by' => $createdBy,
            'updated_at' => $updatedAt,
            'author'     => $author,
            'prev_sha'   => $prevSha,
        ];
    }

    // ── Staging (private) ──────────────────────────────────────────────

    /**
     * Flush a staged .meta — commits the .md content, appends a changelog
     * entry, then removes the .meta file.  Returns the new commit SHA.
     *
     * Called by triggers: read-side (different viewer), write-side
     * (different client/date), DELETE, RENAME, and housekeeping.
     */
    private function storageFlushStage(string $id): string
    {
        $metapath = $this->metaPath($id);
        if (!file_exists($metapath)) {
            // Nothing staged — nothing to flush
            return $this->gitLogLastSha($id) ?? '';
        }

        $meta = json_decode(file_get_contents($metapath), true);
        if (!is_array($meta)) {
            unlink($metapath);
            return $this->gitLogLastSha($id) ?? '';
        }

        $author  = $meta['author'] ?? 'unknown';
        $baseSha = $meta['base_commit'] ?? null;

        $notePath = $this->notePath($id);
        $content  = file_exists($notePath) ? file_get_contents($notePath) : '';

        $type    = ($baseSha === null) ? 'CREATE' : 'UPDATE';
        $message = "{$type} {$id}";

        $sha = $this->gitCommitMd($id, $content, $author, $message);

        // Append changelog entry (dirty — will be committed by the NEXT operation)
        $this->changelogAppend([
            'rev'          => $this->changelogNextRev(),
            'version'      => $sha,
            'file'         => $id,
            'type'         => $type,
            'ts'           => time(),
            'prev_version' => $baseSha,
        ]);

        unlink($metapath);
        return $sha;
    }

    /**
     * Flush all staged .meta files.  Used by housekeeping().
     */
    private function storageFlushAllStages(): void
    {
        if (!is_dir($this->notesDir)) return;

        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($this->notesDir, RecursiveDirectoryIterator::SKIP_DOTS)
        );
        foreach ($iterator as $file) {
            if ($file->getExtension() === 'meta') {
                // Reconstruct note ID from the file path
                $relative = substr($file->getPathname(), strlen($this->notesDir));
                $relative = preg_replace('/\.meta$/', '', $relative);
                // Convert / back to : for the ID
                $id = str_replace('/', ':', $relative);
                try {
                    $this->storageFlushStage($id);
                } catch (\Throwable $e) {
                    error_log("GitStorage: flush stage failed for {$id}: " . $e->getMessage());
                }
            }
        }
    }

    /**
     * Core write logic.  Applies staging or direct-commit based on
     * $stageFlushHours and the current staging state.
     *
     * With $stageFlushHours > 0 (production):
     *   - Same client+date → overwrite .md, no commit (debounce)
     *   - Different client/date → flush old stage, then stage new write
     *   - First write → stage new content
     *
     * With $stageFlushHours === 0 (test mode):
     *   - Always commits immediately, never stages.
     *
     * @return ?string  Commit SHA, or null if content was staged (not committed)
     */
    private function storageApplyWrite(string $id, string $content, string $author, int $clientId): ?string
    {
        $metapath = $this->metaPath($id);
        $today    = gmdate('Y-m-d');

        // ── Test / zero-TTL mode: always commit immediately ──────
        if ($this->stageFlushHours === 0) {
            if (file_exists($metapath)) {
                $this->storageFlushStage($id);
            }

            $prevSha = $this->gitLogLastSha($id);
            $type    = ($prevSha === null) ? 'CREATE' : 'UPDATE';
            $message = "{$type} {$id}";
            $sha     = $this->gitCommitMd($id, $content, $author, $message);

            $this->changelogAppend([
                'rev'          => $this->changelogNextRev(),
                'version'      => $sha,
                'file'         => $id,
                'type'         => $type,
                'ts'           => time(),
                'prev_version' => $prevSha,
            ]);

            return $sha;
        }

        // ── Production: staging logic ───────────────────────────

        // If a staged .meta exists, decide what to do
        if (file_exists($metapath)) {
            $meta = json_decode(file_get_contents($metapath), true);
            if (is_array($meta)
                && ($meta['client_id'] ?? 0) === $clientId
                && ($meta['date'] ?? '') === $today) {
                // Same device, same day → overwrite staged content, no commit
                $dir = dirname($this->notePath($id));
                if (!is_dir($dir)) mkdir($dir, 0755, true);
                file_put_contents($this->notePath($id), $content);
                return null;   // staged, no new commit
            }
            // Different device or new day → flush existing stage first
            $this->storageFlushStage($id);
        }

        // Stage this write: write .md + .meta, NO commit
        $dir = dirname($this->notePath($id));
        if (!is_dir($dir)) mkdir($dir, 0755, true);
        file_put_contents($this->notePath($id), $content);
        file_put_contents($metapath, json_encode([
            'author'      => $author,
            'client_id'   => $clientId,
            'date'        => $today,
            'base_commit' => $this->gitLogLastSha($id),
        ], JSON_UNESCAPED_UNICODE));

        return null;   // staged, no commit
    }

    // ── Note reads (StorageInterface) ──────────────────────────────────

    public function noteDeleted(string $id): bool
    {
        return file_exists($this->deletedPath($id));
    }

    public function getNote(string $id): ?array
    {
        if ($this->noteDeleted($id)) return null;
        $path = $this->notePath($id);
        if (!file_exists($path)) return null;

        $content = file_get_contents($path);
        $info    = $this->gitFileInfo($id);

        return [
            'content'    => $content,
            'current'    => $info['sha'] ?? '',
            'created_at' => $info['created_at'],
            'created_by' => $info['created_by'],
            'updated_at' => $info['updated_at'],
        ];
    }

    public function getNoteFull(string $id, int $clientId): ?array
    {
        if ($this->noteDeleted($id)) return null;

        $path = $this->notePath($id);
        if (!file_exists($path)) return null;

        // ── Read-side trigger: flush staged .meta if viewer ≠ author ──
        $metapath = $this->metaPath($id);
        if ($clientId !== 0 && file_exists($metapath)) {
            $meta = json_decode(file_get_contents($metapath), true);
            if (is_array($meta) && ($meta['client_id'] ?? 0) !== $clientId) {
                $this->storageFlushStage($id);
            }
        }

        $content = file_get_contents($path);
        $info    = $this->gitFileInfo($id);

        return [
            'content'    => $content,
            'version'    => $info['sha'] ?? '',
            'prev'       => $info['prev_sha'],
            'author'     => $info['author'],
            'updated_at' => $info['updated_at'],
            'created_at' => $info['created_at'],
            'created_by' => $info['created_by'],
        ];
    }

    public function listNotes(): array
    {
        // Recursively find all .md files
        $notes = [];
        if (!is_dir($this->notesDir)) return [];

        $files = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($this->notesDir, RecursiveDirectoryIterator::SKIP_DOTS)
        );
        foreach ($files as $file) {
            if ($file->getExtension() !== 'md') continue;
            $relative = substr($file->getPathname(), strlen($this->notesDir));
            $id = str_replace('/', ':', preg_replace('/\.md$/', '', $relative));

            // Skip if deleted
            if (file_exists($this->deletedPath($id))) continue;

            $info = $this->gitFileInfo($id);

            $notes[] = [
                'id'         => $id,
                'created_at' => $info['created_at'],
                'updated_at' => $info['updated_at'],
                'current'    => $info['sha'],
            ];
        }

        usort($notes, fn($a, $b) => strcmp($a['id'], $b['id']));
        return $notes;
    }

    // ── Tombstones (StorageInterface) ──────────────────────────────────

    public function listDeletedNotes(): array
    {
        $notes = [];
        if (!is_dir($this->notesDir)) return [];

        $files = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($this->notesDir, RecursiveDirectoryIterator::SKIP_DOTS)
        );
        foreach ($files as $file) {
            if ($file->getExtension() !== 'deleted') continue;
            $relative = substr($file->getPathname(), strlen($this->notesDir));
            $id = str_replace('/', ':', preg_replace('/\.deleted$/', '', $relative));

            $data = json_decode(file_get_contents($file->getPathname()), true);
            $notes[] = [
                'id'         => $id,
                'deleted_at' => (isset($data['deleted_at']) && is_int($data['deleted_at']))
                    ? $data['deleted_at'] : null,
                'deleted_by' => $data['deleted_by'] ?? '',
            ];
        }

        usort($notes, fn($a, $b) => strcmp($a['id'], $b['id']));
        return $notes;
    }

    public function getTombstone(string $id): ?array
    {
        $path = $this->deletedPath($id);
        if (!file_exists($path)) return null;

        $marker = json_decode(file_get_contents($path), true);
        if (!is_array($marker)) return null;

        // Get the last committed content before deletion
        // (excludes the DELETE commit by filtering to Add/Modify only)
        $pathspec = $this->gitPathspec($id, 'md');
        $lines = $this->gitExec(
            ['log', '--follow', '-1', '--diff-filter=AM', '--format=%H', '--', $pathspec], $rc);
        $sha = !empty($lines) ? trim($lines[0]) : null;

        $content = '';
        $createdAt = 0;
        $createdBy = '';
        if ($sha !== null) {
            $showLines = $this->gitExec(['show', "{$sha}:{$pathspec}"], $rc);
            if ($rc === 0) {
                $content = implode("\n", $showLines);
            }
            // Get creation info from the last pre-deletion commit's file info
            // We use a simpler approach: get first commit for the file
            $firstLines = $this->gitExec(
                ['log', '--follow', '--diff-filter=A', '--format=%at %an', '--', $pathspec], $rc);
            if (!empty($firstLines)) {
                $lastLine = end($firstLines);
                $parts = explode(' ', trim($lastLine), 2);
                $createdAt = isset($parts[0]) ? (int)$parts[0] : 0;
                $createdBy = $parts[1] ?? '';
            }
        }

        return [
            'content'    => $content,
            'version'    => $sha ?? '',
            'created_at' => $createdAt,
            'created_by' => $createdBy,
            'deleted_at' => $marker['deleted_at'] ?? 0,
            'deleted_by' => $marker['deleted_by'] ?? '',
        ];
    }

    public function reviveNote(string $id): void
    {
        $deletedPath = $this->deletedPath($id);
        if (!file_exists($deletedPath)) return;

        // Recover the last committed content via git show
        $pathspec = $this->gitPathspec($id, 'md');
        $shaLines = $this->gitExec(
            ['log', '--follow', '-1', '--diff-filter=AM', '--format=%H', '--', $pathspec], $rc);
        $sha = !empty($shaLines) ? trim($shaLines[0]) : null;

        if ($sha !== null) {
            $showLines = $this->gitExec(['show', "{$sha}:{$pathspec}"], $rc);
            if ($rc === 0) {
                $content = implode("\n", $showLines);
                $dir = dirname($this->notePath($id));
                if (!is_dir($dir)) mkdir($dir, 0755, true);
                file_put_contents($this->notePath($id), $content);
            }
        }

        unlink($deletedPath);
    }

    public function hardDeleteNote(string $id): void
    {
        $path = $this->deletedPath($id);
        if (file_exists($path)) {
            unlink($path);
        }
    }

    // ── Logged write operations (StorageInterface) ─────────────────────

    public function putNoteLogged(
        string $id, string $content, string $author,
        int $clientId, string $clientVersion
    ): ?array {
        if ($this->noteDeleted($id)) {
            $this->reviveNote($id);
        }

        $sha = $this->storageApplyWrite($id, $content, $author, $clientId);

        // null = staged (not committed)
        if ($sha === null) {
            return [null, true];   // version=null, dirty=true
        }

        // Committed — changelog already appended inside storageApplyWrite
        return [$sha, false];
    }

    public function deleteNoteLogged(string $id, string $author): bool
    {
        if ($this->noteDeleted($id)) return false;
        if (!$this->noteExists($id)) return false;

        // Flush any staged content before deleting
        if (file_exists($this->metaPath($id))) {
            $this->storageFlushStage($id);
        }

        $current = $this->gitLogLastSha($id);

        // Write .deleted marker (NOT committed to git)
        $deletedPath = $this->deletedPath($id);
        $dir = dirname($deletedPath);
        if (!is_dir($dir)) mkdir($dir, 0755, true);
        file_put_contents($deletedPath, json_encode([
            'deleted_at' => time(),
            'deleted_by' => $author,
        ], JSON_UNESCAPED_UNICODE));

        // git rm + commit (includes dirty changelog from previous operation)
        $message = "DELETE {$id}";
        $sha = $this->gitCommitDeleteMd($id, $author, $message);

        // Append changelog DELETE entry (dirty — committed by next op)
        $this->changelogAppend([
            'rev'          => $this->changelogNextRev(),
            'file'         => $id,
            'type'         => 'DELETE',
            'ts'           => time(),
            'version'      => $sha,
            'prev_version' => $current,
            'deleted_by'   => $author,
        ]);

        return true;
    }

    public function renameNoteLogged(
        string $oldId, string $newId, string $author
    ): bool {
        if ($newId === '') return false;
        if (!$this->noteExists($oldId)) return false;
        if ($this->noteExists($newId)) return false;
        if ($this->noteDeleted($newId)) $this->hardDeleteNote($newId);

        // Flush any staged content on the source before renaming
        if (file_exists($this->metaPath($oldId))) {
            $this->storageFlushStage($oldId);
        }

        // git mv + commit (includes dirty changelog from previous operation)
        $message = "RENAME {$oldId} → {$newId}";
        $sha = $this->gitCommitRenameMd($oldId, $newId, $author, $message);

        // Append changelog RENAME entry (dirty — committed by next op)
        $this->changelogAppend([
            'rev'          => $this->changelogNextRev(),
            'file'         => $oldId,
            'type'         => 'RENAME',
            'ts'           => time(),
            'renamed_to'   => $newId,
            'renamed_by'   => $author,
            'version'      => $sha,
            'prev_version' => null,
        ]);

        return true;
    }

    // ── Sync helpers (StorageInterface) ────────────────────────────────

    public function markVersionSeen(string $id, int $clientId): void
    {
        // Git commits are immutable — no exclusive flag to clear.
        // This is a deliberate no-op.  See docs/TODO/git-storage.md §
        // "Key Simplification: Commits Are Immutable".
    }

    // ── Version history (StorageInterface) ─────────────────────────────

    public function getVersionList(string $id): array
    {
        if ($this->noteDeleted($id)) return [];
        if (!file_exists($this->notePath($id))) return [];

        $pathspec = $this->gitPathspec($id, 'md');
        // Use --follow to track history across renames, and --name-only to get
        // the filename at each commit (needed by getVersionContent for pre-rename commits).
        // Format: %H = full SHA, %at = timestamp, %an = author, %P = parent hashes.
        // --name-only adds a blank line then the filename after each commit.
        $lines = $this->gitExec(
            ['log', '--follow', '--format=%H %at %an %P', '--name-only', '--', $pathspec], $rc);

        // Parse git log --name-only output.
        // Format for each commit:
        //   {sha} {ts} {author} {parent}     ← commit line
        //                                      ← blank line
        //   {filename}                         ← filename at this commit
        //                                      ← blank line separator
        $result = [];
        $i = 0;
        $count = count($lines);
        while ($i < $count) {
            $line = trim($lines[$i]);
            $i++;

            // Skip blank lines
            if ($line === '') continue;

            // Parse commit line
            $parts = explode(' ', $line);
            if (count($parts) < 3) continue;  // not a commit line (e.g. filename without commit)
            $sha    = $parts[0];
            $ts     = (int)$parts[1];
            $author = $parts[2];
            $parent = $parts[3] ?? null;

            // Skip blank lines to get to the filename
            $filename = $pathspec;  // fallback
            while ($i < $count && trim($lines[$i]) === '') { $i++; }
            if ($i < $count) {
                $nameLine = trim($lines[$i]);
                if ($nameLine !== '' && !str_contains($nameLine, ' ')) {
                    $filename = $nameLine;
                }
                $i++;
            }

            // Embed the filename-at-commit in the opaque key: sha\x00path
            $result[] = [
                'key'      => $sha . "\x00" . $filename,
                'author'   => $author,
                'saved_at' => $ts,
                'prev'     => ($parent !== '' && $parent !== null) ? $parent : null,
            ];
        }

        // git log returns newest first — already in the right order
        return $result;
    }

    public function getVersionContent(string $id, string $vkey): ?string
    {
        if ($this->noteDeleted($id)) return null;

        // vkey may be a composite "{sha}\x00{filename-at-commit}" from getVersionList,
        // or a plain SHA from the changelog / getNoteFull.
        $sep = strpos($vkey, "\x00");
        if ($sep !== false) {
            $sha      = substr($vkey, 0, $sep);
            $pathspec = substr($vkey, $sep + 1);
        } else {
            $sha      = $vkey;
            $pathspec = $this->gitPathspec($id, 'md');
        }

        $lines = $this->gitExec(['show', "{$sha}:{$pathspec}"], $rc);
        if ($rc !== 0) return null;
        return implode("\n", $lines);
    }

    // ── Changelog (StorageInterface) ───────────────────────────────────
    //
    // These methods operate on the working-tree changelog.jsonl, which
    // always contains the full truth (including the trailing entry that
    // hasn't been committed to git yet).

    public function changelogAppend(array $entry): void
    {
        $fh = fopen($this->changelogFile, 'a');
        if (!$fh) return;
        flock($fh, LOCK_EX);
        fwrite($fh, json_encode($entry, JSON_UNESCAPED_UNICODE) . "\n");
        flock($fh, LOCK_UN);
        fclose($fh);
    }

    public function changelogNextRev(): int
    {
        if (!file_exists($this->changelogFile)) return 1;

        $fh = fopen($this->changelogFile, 'r');
        if (!$fh) return 1;

        fseek($fh, 0, SEEK_END);
        $size = ftell($fh);
        if ($size === 0) { fclose($fh); return 1; }

        $buf  = '';
        $pos  = $size;
        $last = '';

        while ($pos > 0) {
            $chunk = min(256, $pos);
            $pos  -= $chunk;
            fseek($fh, $pos);
            $buf = fread($fh, $chunk) . $buf;
            foreach (array_reverse(explode("\n", rtrim($buf))) as $line) {
                $line = trim($line);
                if ($line !== '') { $last = $line; break 2; }
            }
        }
        fclose($fh);

        if ($last === '') return 1;
        $entry = json_decode($last, true);
        return isset($entry['rev']) ? (int)$entry['rev'] + 1 : 1;
    }

    public function changelogSince(int $since): array
    {
        if (!file_exists($this->changelogFile)) return [];

        $entries = [];
        $fh      = fopen($this->changelogFile, 'r');
        if (!$fh) return [];

        while (($line = fgets($fh)) !== false) {
            $line = trim($line);
            if ($line === '') continue;
            $entry = json_decode($line, true);
            if (!is_array($entry)) continue;
            if ((int)($entry['rev'] ?? 0) > $since) {
                $entries[] = $entry;
            }
        }

        fclose($fh);
        return $entries;
    }

    public function changelogCurrentRev(): int
    {
        return $this->changelogNextRev() - 1;
    }

    public function changelogEarliestRev(): int
    {
        if (!file_exists($this->changelogFile)) return 1;

        $fh = fopen($this->changelogFile, 'r');
        if (!$fh) return 1;

        while (($line = fgets($fh)) !== false) {
            $line = trim($line);
            if ($line === '') continue;
            $entry = json_decode($line, true);
            $rev   = is_array($entry) ? ($entry['rev'] ?? null) : null;
            if (is_int($rev)) {
                fclose($fh);
                return $rev;
            }
        }

        fclose($fh);
        return 1;
    }

    // ── Housekeeping (StorageInterface) ────────────────────────────────

    public function housekeeping(string $entry): int
    {
        if ($entry === 'sync') {
            $removed = 0;

            // Flush stale .meta files
            $this->storageFlushAllStages();

            // Purge expired tombstones
            $removed += $this->purgeDeletedNotes();

            return $removed;
        }
        return 0;
    }

    // ── Capabilities (StorageInterface) ────────────────────────────────

    public function e2eeSupport(): bool
    {
        return false;
    }

    // ── Private: note existence ────────────────────────────────────────

    /** Check whether a live (non-deleted) note exists. */
    private function noteExists(string $id): bool
    {
        return !$this->noteDeleted($id) && file_exists($this->notePath($id));
    }

    // ── Private: raw CRUD (for test compatibility via storage_invoke) ──

    /**
     * Write a note's .md file directly (no changelog, no staging, no git commit).
     * Used only by tests via reflection (storage_invoke).
     */
    private function putNote(string $id, array $data): void
    {
        $path = $this->notePath($id);
        $dir  = dirname($path);
        if (!is_dir($dir)) mkdir($dir, 0755, true);
        // Store the data as pretty-printed JSON inside the .md file
        // so tests can read it back via getNote().
        file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }

    // ── Private: tombstone maintenance ─────────────────────────────────

    /**
     * Permanently remove tombstones whose deleted_at is older than
     * $deletedNoteTtlDays.
     *
     * @return int  Number of tombstones removed
     */
    private function purgeDeletedNotes(): int
    {
        $cutoff  = time() - ($this->deletedNoteTtlDays * 86400);
        $removed = 0;

        if (!is_dir($this->notesDir)) return 0;

        $files = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($this->notesDir, RecursiveDirectoryIterator::SKIP_DOTS)
        );
        foreach ($files as $file) {
            if ($file->getExtension() !== 'deleted') continue;
            $data = json_decode(file_get_contents($file->getPathname()), true);
            $ts   = $data['deleted_at'] ?? null;
            if ($ts !== null && (int)$ts < $cutoff) {
                unlink($file->getPathname());
                $removed++;
            }
        }

        return $removed;
    }
}
