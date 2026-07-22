# Leaf

**A personal notes app with offline-first sync, Markdown editing, and a zero-framework TypeScript frontend.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Leaf is a self-hosted, single-user note-taking application designed for shared PHP hosting environments. It stores everything as flat files on the server, in a format that is easy to back up, inspect, and script against.

---

## Features

- **Markdown editor** — CodeMirror 6 with syntax highlighting, autocomplete, and [[wiki-link]] navigation
- **Tabbed editing** — View (rendered), Raw (source), and Meta (frontmatter) tabs per note
- **Frontmatter** — YAML-style metadata (`title`, `summary`, `user-tags`, custom fields)
- **Hierarchical notes** — colon-separated IDs (`work:meetings:standup`) rendered as a file tree in the sidebar
- **Offline-first** — all reads/writes go to IndexedDB first; changes sync to the server when online
- **Trash** — soft-delete with restore and auto-purge after 7 days
- **Version history** — full version chain per note with per-author tracking
- **Wiki-links** — `[[note]]` syntax with autocomplete and backlink navigation
- **Fenced content** — Mermaid diagrams, Graphviz, math (KaTeX), SVG Bob, spreadsheets, ASCII math
- **Syntax highlighting** — highlight.js with lazy-loaded language support
- **Theming** — dark, light, magenta, and paired-12 themes with CodeMirror + hljs integration
- **PWA** — installable, cache-first service worker, standalone app experience
- **Cook mode** — Screen Wake Lock toggle to keep the screen on while referencing notes
- **JWT auth** — access token in memory (XSS-resistant), refresh token in httpOnly cookie
- **Shared hosting ready** — subdirectory-safe, PHP 8.x, no database required

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | TypeScript 5.x, esbuild, no UI framework |
| **Editor** | CodeMirror 6 |
| **Markdown** | markdown-it with lazy-loaded extensions |
| **Client DB** | Dexie 3.x (IndexedDB wrapper) |
| **Backend** | PHP 8.x, flat-file storage |
| **Auth** | JWT HS256 + bcrypt htpasswd + httpOnly refresh cookies |
| **Build** | pnpm, esbuild (code splitting), tsc (type checking) |
| **Testing** | Vitest + jsdom, PHPUnit, shell integration tests |
| **Docs** | TypeDoc (SPA), phpDocumentor (PHP) |

---

## Project Structure

```
leaf/
├── src/
│   ├── ts/              TypeScript sources (~70 files)
│   │   ├── app.ts           Entry point / boot sequence
│   │   ├── notes.ts         Data access layer
│   │   ├── sync.ts          Offline sync queue
│   │   ├── db.ts            Dexie IndexedDB schema
│   │   ├── auth.ts          JWT + refresh token logic
│   │   ├── markdown.ts      markdown-it plugin loader
│   │   ├── fence-hydrate.ts Fenced block renderer
│   │   ├── codemirror/      Editor config & extensions
│   │   ├── extensions/      markdown-it extension wrappers
│   │   └── system-notes/    Built-in system notes
│   └── php/             PHP backend (~16 files)
│       ├── router.php       Request dispatcher
│       ├── auth.php         Login / refresh / logout
│       ├── sync.php         Sync push/pull protocol
│       ├── trash.php        Soft-delete management
│       ├── history.php      Version history
│       ├── storage/         Storage backend (interface + flat-file)
│       └── audit/           Audit log interface + flat-file
├── api/                 Per-instance API entry points
├── spa/                 Built SPA output + CSS themes
├── tests/
│   ├── spa/             Vitest frontend tests
│   ├── php/             PHPUnit backend tests
│   └── integration/     Shell script integration tests
├── data/                Runtime data (htpasswd, notes, changelog)
└── docs/                documentation
```

---

## Quick Start

### Prerequisites

- **PHP 8.x** with `ctype`, `json`, `mbstring` extensions
- **Node.js 18+** and **pnpm** (only for development)
- **Composer** (for PHP dev dependencies)

### Setup

```bash
# Clone the repository
git clone https://github.com/yourname/leaf.git
cd leaf

# Install dependencies
pnpm install
composer install

# Generate config (with a random JWT secret)
make config-php
# Review api/config.php — adjust DATA_ROOT if needed

# Build the SPA
pnpm run build

# Start the dev server
make serve
```

`make serve` starts two servers:

| Server | Port | What it serves |
|---|---|---|
| PHP built-in | `:9000` | API (`/api/`, `/demo/api/`) + static demo SPA |
| Vite dev | `:5173` | Live-reloading SPA at `/spa/`, API proxied to `:9000` |

The **demo instance** (`http://localhost:9000/demo/spa/`) is a pre-built production copy that showcases the project's features. Its notes live in `demo/data/` inside the repo.

The **dev instance** (`http://localhost:5173/spa/`) is the Vite-powered development SPA with hot module replacement. Its notes live at the `DATA_ROOT` path defined in `api/config.php` — outside the repository by default. Verify with:

```bash
php api/index.php spacfg --data
# → /path/to/leaf-data/
```

The `DATA_ROOT` directory (and its `notes/` subdirectory) is **created automatically** on first boot by the storage backend. You don't need to `mkdir` it — just make sure the parent directory is writable.

### One-command setup (from scratch)

```bash
pnpm install && composer install && make config-php && pnpm run build && make serve
```

---

## Usage

### Editing notes

- **Create**: `Ctrl+N` or the `+` button in the sidebar
- **Save**: `Ctrl+S` (auto-save also runs 2 seconds after you stop typing)
- **Wiki-links**: Type `[[` in the editor — autocomplete shows matching note titles
- **Tabs**: Switch between **View** (rendered Markdown), **Raw** (source), and **Meta** (frontmatter fields)

### Sync

Sync runs automatically every 30 seconds when logged in. Local changes are queued in IndexedDB and pushed to the server when online. Server changes are pulled and merged locally. Conflict resolution uses last-write-wins with full version history preserved.

### Trash

Deleted notes go to the trash (soft-delete). Restore them within 7 days from the trash sidebar. After 7 days, they are permanently purged on next boot.

### Themes

Open the app menu (top-right) → **Theme** → choose from dark, light, magenta, or paired-12. Your preference is saved to localStorage.

---

## CLI

The API entry point (`api/index.php`) doubles as a command-line interface. Run it without arguments to see available subcommands:

```bash
php api/index.php
# Available subcommands:
#   adduser    htpasswd user management tool
#   cron       periodic maintenance tasks (called via cron)
#   notes      dump note content or list notes via the storage backend
#   rotatejwt  regenerate the JWT_SECRET for this instance
#   spacfg     print the SPA config as JSON, or show the data directory
```

Each subcommand lives in `src/php/<name>_impl.php` and is auto-discovered by the router — no registration needed. Subcommands inherit the full config bootstrap (storage backend, audit, constants), so they work with any storage backend the instance is configured to use.

### Subcommand reference

| Command | Description |
|---|---|
| `php api/index.php spacfg` | Print `$spa_config` as pretty-printed JSON |
| `php api/index.php spacfg --data` | Print `DATA_ROOT` path |
| `php api/index.php notes --list` | List all live note IDs |
| `php api/index.php notes <id>` | Dump the latest content of a note |
| `php api/index.php adduser add <user> <pass>` | Create or update a user |
| `php api/index.php adduser delete <user>` | Remove a user |
| `php api/index.php adduser list` | List all usernames |
| `php api/index.php adduser check <user> <pass>` | Test a password |
| `php api/index.php rotatejwt` | Regenerate JWT_SECRET (invalidates all sessions) |
| `php api/index.php cron` | Run housekeeping silently (for cron jobs) |
| `php api/index.php cron --verbose` | Run housekeeping with diagnostic output |

### Enabling authentication

Auth is controlled in `api/config.php`:

```php
$spa_config = [
    'auth' => [
        'enabled' => true,   // set to true to require login
    ],
    // ...
];
```

When auth is enabled for the first time, create a user:

```bash
php api/index.php adduser add alice hunter2
```

This writes a bcrypt hash to `DATA_ROOT/users.htpasswd`. Log in at the SPA with the username and password. The SPA stores an access token in memory and a refresh token in an httpOnly cookie — no credentials touch localStorage.

To disable auth, set `'enabled' => false` — the SPA skips the login screen and all API requests use the `anonymous` identity.

## Development

```bash
make help           # Show all available commands

make test           # Run all tests (JS + PHPUnit + integration)
make test-js        # Vitest frontend tests
make test-phpunit   # PHPUnit backend tests
make test-integration  # Integration tests (curl-based)

make typecheck      # TypeScript type checking
make build-spa       # Build the SPA
make build          # Alias for build-spa

make docs           # Generate all API docs (PHP + SPA)
make docs-php       # phpDocumentor → docs/api/
make docs-spa       # TypeDoc → docs/spa/
make docs-clean     # Remove generated docs

make clean          # Remove test artifacts and build output

make serve          # Start dev server (PHP :9000 + Vite :5173)
```


## Testing

| Suite | Command | Framework |
|---|---|---|
| Frontend unit | `pnpm test` | Vitest + jsdom + fake-indexeddb |
| Backend unit | `make test-phpunit` | PHPUnit 11 |
| Integration | `make test-integration` | Shell scripts (curl-based) |

The frontend tests use `fake-indexeddb` to simulate IndexedDB in Node.js. No browser required.

---

## Documentation

Generated API documentation:

| Source | Tool | Output | Command |
|---|---|---|---|
| PHP (`src/php/`) | phpDocumentor v3.10 | `docs/api/` | `make docs-php` |
| TypeScript (`src/ts/`) | TypeDoc v0.28 | `docs/spa/` | `make docs-spa` |

---

## Deployment

Designed for shared PHP hosting (Namecheap, LiteSpeed, Phusion Passenger, etc.).

```bash
# Build for production
pnpm run build

# Upload to server
#   spa/       → public_html/spa/
#   api/       → public_html/api/
#   src/php/   → (any path, referenced by api/config.php)
#   data/      → outside web root (set DATA_ROOT in config.php)

# On the server, configure:
#   1. api/config.php — JWT_SECRET, DATA_ROOT, CORS policy
#   2. Create users with:  php api/index.php adduser add <username> <password>
#   3. Ensure the DATA_ROOT parent directory is writable by the PHP process
```

The SPA uses relative paths everywhere — it works from any subdirectory without reconfiguration.

---

## License

MIT © 2026 Alejandro Liu. See [LICENSE](LICENSE) for details.
