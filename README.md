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

# Configure
cp api/config.php-sample api/config.php
# Edit api/config.php — set JWT_SECRET, DATA_ROOT, etc.

# Create initial user
php api/adduser.php alice
# (types password interactively)

# Build the SPA
pnpm run build

# Start dev server
make serve
# → http://localhost:9000
```

### One-command setup (from scratch)

```bash
pnpm install && composer install && cp api/config.php-sample api/config.php && php api/adduser.php admin && pnpm run build && make serve
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

make serve          # Start PHP dev server on :9000
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
#   2. Create users with:  php api/adduser.php <username>
#   3. Ensure data/ is writable by the PHP process
```

The SPA uses relative paths everywhere — it works from any subdirectory without reconfiguration.

---

## License

MIT © 2026 Alejandro Liu. See [LICENSE](LICENSE) for details.
