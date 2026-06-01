<?php
/**
 * FlatFileStorage.php — flat-file storage backend
 *
 * Implements StorageInterface using the filesystem:
 *   notes/{id}.json         — live note
 *   notes/{id}.deleted.json — soft-deleted tombstone
 *   changelog.jsonl         — append-only change log
 *
 * See StorageInterface.php for the public API contract.
 *
 * Live note file structure ({id}.json):
 * {
 *   "current":    "2026-05-26:1:3455",
 *   "created_at": 1748200000,
 *   "created_by": "alice",
 *   "versions": {
 *     "2026-05-26:1:alice": {
 *       "author":    "alice",
 *       "saved_at":  1748200000,
 *       "content":   "<opaque blob>",
 *       "prev":      "2026-05-25:1:alice" | null,
 *       "exclusive": true
 *     }
 *   }
 * }
 *
 * Tombstone file structure ({id}.deleted.json):
 * Same as the live note, plus two extra top-level fields:
 * {
 *   "deleted_at": 1748350000,
 *   "deleted_by": "alice",
 *   ... same as live note ...
 * }
 *
 * Version key format: "{date}:{counter}:{client_id}"
 *   Lexicographic sort == chronological order.
 *   Counter resets per (date, client_id) pair.
 *   Treated as an opaque identifier by consumers.
 *
 * Changelog entry:
 * {"rev":N,"file":"id","type":"CREATE|UPDATE|DELETE|RENAME",
 *  "ts":N,"version":"key"|null,"prev_version":"key"|null,
 *  "renamed_to":"new-id","renamed_by":"author",          // RENAME only
 *  "deleted_by":"author"}                                // DELETE only
 */

require_once __DIR__ . '/StorageInterface.php';

class FlatFileStorage implements StorageInterface
{
    // ── Constructor ────────────────────────────────────────────────────

    /**
     * @param string $notesDir       Path to the notes/ directory
     * @param string $changelogFile  Path to the changelog JSONL file
     * @param int    $deletedNoteTtlDays  Days before tombstones are permanently purged
     */
    private readonly string $notesDir;
    private readonly string $changelogFile;

    /**
     * @param string $dataRoot           Path to the data/ directory
     * @param int    $deletedNoteTtlDays  Days before tombstones are permanently purged
     */
    public function __construct(
        string $dataRoot,
        private readonly int $deletedNoteTtlDays = 30,
    ) {
	$dataRoot = rtrim($dataRoot,'/');
        $this->notesDir      = $dataRoot . '/notes/';
        $this->changelogFile = $dataRoot . '/changelog.jsonl';
        if (!is_dir($this->notesDir)) {
            mkdir($this->notesDir, 0755, true);
        }
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
        $data = json_decode(file_get_contents($path), true);
        return is_array($data) ? $data : null;
    }

    public function getNoteFull(string $id, int $clientId): ?array
    {
        $note = $this->getNote($id);
        if (!$note) return null;

        $current = $note['current'] ?? null;
        $version = ($current && isset($note['versions'][$current]))
            ? $note['versions'][$current] : null;

        return [
            'content'    => $version ? ($version['content'] ?? '') : '',
            'version'    => $current ?? '',
            'prev'       => $version ? ($version['prev'] ?? null) : null,
            'author'     => $version ? ($version['author'] ?? '') : '',
            'updated_at' => $version ? ($version['saved_at'] ?? 0) : 0,
            'created_at' => $note['created_at'] ?? 0,
            'created_by' => $note['created_by'] ?? '',
        ];
    }

    public function listNotes(): array
    {
        $files = glob($this->notesDir . '*.json') ?: [];
        $files = array_filter($files, fn($f) =>
            !str_contains($f, '.tmp.') && !str_ends_with($f, '.deleted.json')
        );

        $notes = [];
        foreach ($files as $file) {
            $data = json_decode(file_get_contents($file), true);
            if (!is_array($data)) continue;

            $current  = $data['current'] ?? null;
            $saved_at = ($current && isset($data['versions'][$current]))
                ? $data['versions'][$current]['saved_at']
                : ($data['created_at'] ?? filemtime($file));

            $notes[] = [
                'id'         => basename($file, '.json'),
                'created_at' => $data['created_at'] ?? filemtime($file),
                'updated_at' => $saved_at,
                'current'    => $current,
            ];
        }

        usort($notes, fn($a, $b) => strcmp($a['id'], $b['id']));
        return $notes;
    }

    // ── Tombstones (StorageInterface) ──────────────────────────────────

    public function listDeletedNotes(): array
    {
        $paths = glob($this->notesDir . '*.deleted.json') ?: [];
        $notes = [];

        foreach ($paths as $path) {
            $data = json_decode(file_get_contents($path), true);
            $notes[] = [
                'id'         => basename($path, '.deleted.json'),
                'deleted_at' => (isset($data['deleted_at']) && is_int($data['deleted_at']))
                    ? $data['deleted_at']
                    : null,
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

        $data = json_decode(file_get_contents($path), true);
        if (!is_array($data)) return null;

        $current = $data['current'] ?? null;
        $content = ($current && isset($data['versions'][$current]))
            ? ($data['versions'][$current]['content'] ?? '') : '';

        return [
            'content'    => $content,
            'version'    => $current ?? '',
            'created_at' => $data['created_at'] ?? 0,
            'created_by' => $data['created_by'] ?? '',
            'deleted_at' => $data['deleted_at'] ?? 0,
            'deleted_by' => $data['deleted_by'] ?? '',
        ];
    }

    public function reviveNote(string $id): void
    {
        $path = $this->deletedPath($id);
        if (!file_exists($path)) return;

        $data = json_decode(file_get_contents($path), true);
        if (is_array($data)) {
            unset($data['deleted_at']);
            unset($data['deleted_by']);
            file_put_contents(
                $this->notePath($id),
                json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
            );
        }
        unlink($path);
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
        if ($this->noteDeleted($id)) $this->reviveNote($id);

        $preNote = $this->getNote($id);
        $isNew   = $preNote === null;

        if (!$isNew && $preNote['current'] !== null
            && $preNote['current'] !== $clientVersion) {
            error_log("Conflict on {$id}: client {$clientVersion}"
                . " != server {$preNote['current']}");
        }

        $vkey = $this->applyWrite($id, $content, $author, $clientId);

        $note      = $this->getNote($id);
        $prevVkey  = $note['versions'][$vkey]['prev'] ?? null;

        $entry = [
            'rev'          => $this->changelogNextRev(),
            'file'         => $id,
            'type'         => $isNew ? 'CREATE' : 'UPDATE',
            'ts'           => time(),
            'version'      => $vkey,
            'prev_version' => $prevVkey,
        ];
        $this->changelogAppend($entry);
        return [$vkey, false];
    }

    public function deleteNoteLogged(string $id, string $author): bool
    {
        if ($this->noteDeleted($id)) return false;
        if (!$this->noteExists($id)) return false;

        $note    = $this->getNote($id);
        $current = $note['current'] ?? null;

        $this->deleteNote($id, $author);

        $entry = [
            'rev'          => $this->changelogNextRev(),
            'file'         => $id,
            'type'         => 'DELETE',
            'ts'           => time(),
            'version'      => null,
            'prev_version' => $current,
            'deleted_by'   => $author,
        ];
        $this->changelogAppend($entry);
        return true;
    }

    public function renameNoteLogged(
        string $oldId, string $newId, string $author
    ): bool {
        if ($newId === '') return false;
        if (!$this->noteExists($oldId)) return false;
        if ($this->noteExists($newId)) return false;
        if ($this->noteDeleted($newId)) $this->hardDeleteNote($newId);

        if (!$this->renameNote($oldId, $newId)) return false;

        $entry = [
            'rev'          => $this->changelogNextRev(),
            'file'         => $oldId,
            'type'         => 'RENAME',
            'ts'           => time(),
            'renamed_to'   => $newId,
            'renamed_by'   => $author,
            'version'      => null,
            'prev_version' => null,
        ];
        $this->changelogAppend($entry);
        return true;
    }

    // ── Sync helpers (StorageInterface) ────────────────────────────────

    public function markVersionSeen(string $id, int $clientId): void
    {
        $note = $this->getNote($id);
        if (!$note) return;

        $currentVkey = $note['current'] ?? null;
        if (!$currentVkey) return;
        if (!$note['versions'][$currentVkey]['exclusive']) return;

        list(,,$curClient) = explode(':', $currentVkey, 3);
        if (((int)$curClient) == $clientId) return;

        // Another user is receiving this version → clear exclusivity
        $note['versions'][$currentVkey]['exclusive'] = false;
        $this->putNote($id, $note);
    }

    // ── Version history (StorageInterface) ─────────────────────────────

    public function getVersionList(string $id): array
    {
        $note = $this->getNote($id);
        if (!$note) return [];

        $versions = $note['versions'] ?? [];
        $result   = [];
        foreach ($versions as $vkey => $ventry) {
            $result[] = [
                'key'      => $vkey,
                'author'   => $ventry['author'] ?? '',
                'saved_at' => $ventry['saved_at'] ?? 0,
                'prev'     => $ventry['prev'] ?? null,
            ];
        }
        usort($result, fn($a, $b) => $b['saved_at'] <=> $a['saved_at']);
        return $result;
    }

    public function getVersionContent(string $id, string $vkey): ?string
    {
        $note = $this->getNote($id);
        if (!$note) return null;
        $versions = $note['versions'] ?? [];
        return isset($versions[$vkey])
            ? ($versions[$vkey]['content'] ?? '') : null;
    }

    // ── Changelog (StorageInterface) ───────────────────────────────────

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
            return $this->purgeDeletedNotes();
        }
        return 0;
    }

    // ── Capabilities (StorageInterface) ────────────────────────────────

    public function e2eeSupport(): bool
    {
        return true;
    }

    // ── Private: path helpers ──────────────────────────────────────────

    private function notePath(string $id): string
    {
        return $this->notesDir . $id . '.json';
    }

    private function deletedPath(string $id): string
    {
        return $this->notesDir . $id . '.deleted.json';
    }

    // ── Private: note existence ────────────────────────────────────────

    /** Check whether a live (non-deleted) note exists. */
    private function noteExists(string $id): bool
    {
        return !$this->noteDeleted($id) && file_exists($this->notePath($id));
    }

    // ── Private: raw CRUD (no changelog) ───────────────────────────────

    /**
     * Write a note file atomically using temp file + rename.
     * Creates the note if it does not exist.
     */
    private function putNote(string $id, array $data): void
    {
        $path = $this->notePath($id);
        $tmp  = $path . '.tmp.' . getmypid();
        file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        rename($tmp, $path);
    }

    /**
     * Soft-delete a note by writing the .deleted.json tombstone.
     * Idempotent — safe to call on an already-deleted note.
     */
    private function deleteNote(string $id, string $deletedBy): void
    {
        $path = $this->notePath($id);
        if (!file_exists($path) || $this->noteDeleted($id)) return;

        $data = json_decode(file_get_contents($path), true);
        if (is_array($data)) {
            $data['deleted_at'] = time();
            $data['deleted_by'] = $deletedBy;
            file_put_contents(
                $this->deletedPath($id),
                json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
            );
        }
        unlink($path);
    }

    /**
     * Rename a live note by moving its JSON file.
     * Both files must be on the same filesystem, so rename() is atomic.
     */
    private function renameNote(string $oldId, string $newId): bool
    {
        if ($this->noteDeleted($oldId)) return false;
        if ($this->noteDeleted($newId)) return false;
        if (!file_exists($this->notePath($oldId))) return false;
        if (file_exists($this->notePath($newId))) return false;

        return rename($this->notePath($oldId), $this->notePath($newId));
    }

    // ── Private: versioning ────────────────────────────────────────────

    /**
     * Compute the version key for an incoming save and whether it overwrites.
     *
     * Overwrite rule: same client_id AND same UTC date AND the current
     * version's exclusive flag is still true.
     * New version: everything else — find highest counter for
     * (date, client_id) and increment.
     *
     * @return array{0: string, 1: bool}  [version_key, is_overwrite]
     */
    private function resolveVersion(array $note, int $clientId): array
    {
        $today    = gmdate('Y-m-d');
        $versions = $note['versions'] ?? [];
        $current  = $note['current']  ?? null;

        if ($current) {
            list($curDate, $curSeq, $curClient) = explode(':', $current, 3);
            $curClientId = (int)$curClient;
            $curSeq      = (int)$curSeq;
            $exclusive   = $note['versions'][$current]['exclusive'] ?? false;

            if ($curClientId === $clientId && $curDate === $today && $exclusive) {
                return [$current, true];
            }
        }

        // Find first available counter for (today, client_id) to build the new key
        $i = 0;
        do {
            $nextV = implode(':', [$today, $i++, $clientId]);
        } while (isset($versions[$nextV]));

        return [$nextV, false];
    }

    /**
     * Write a new version of a note's content.
     *
     * @return string  The version key that was written
     */
    private function applyWrite(
        string $id, string $content, string $author, int $clientId
    ): string {
        $note   = $this->getNote($id);
        $isNew  = ($note === null);

        $note = $note ?? [
            'current'    => null,
            'created_at' => time(),
            'versions'   => [],
        ];

        // Record the original creator on the first write (never overwritten).
        if ($isNew) {
            $note['created_by'] = $author;
        }

        [$vkey, $overwrite] = $this->resolveVersion($note, $clientId);

        $prevVkey = $overwrite
            ? ($note['versions'][$vkey]['prev'] ?? null)
            : $note['current'];

        $note['versions'][$vkey] = [
            'author'    => $author,
            'saved_at'  => time(),
            'content'   => $content,
            'prev'      => $prevVkey,
            'exclusive' => true,
        ];

        ksort($note['versions']);
        $note['current'] = $vkey;

        $this->putNote($id, $note);
        return $vkey;
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

        foreach (glob($this->notesDir . '*.deleted.json') ?: [] as $path) {
            $data = json_decode(file_get_contents($path), true);
            $ts   = $data['deleted_at'] ?? null;
            if ($ts !== null && (int)$ts < $cutoff) {
                unlink($path);
                $removed++;
            }
        }

        return $removed;
    }
}
