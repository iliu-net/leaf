# Internals

* [ ] command line interface
  - bulk export/import
* [ ] Generate static web site.
  - Use bulk export to create a file set that can be used by an
    existing JavaScript based static web site generator.
  - Use node.js (so we can use the same rendering engines)
  - ~~Question: Use existing end-point, Read files directly or New end-point?~~
  - Convert notes to a Github Pages site
* [ ] Node.js web server
  - Runs on web server.  [Namecheap](https://www.namecheap.com/support/knowledgebase/article.aspx/10047/2182/how-to-work-with-nodejs-app/)
  - Question: Use existing end-point, Read files directly or New end-point?
  - Serves pages read-only
* [ ] Purge versions and/or changelog

Later

* E2EE
  * Architecture designed for it (opaque content); not implemented
* Background sync
  * Service worker sync hook stubbed but not wired
* MySQL migration
  * Storage abstraction layer in place; target schema documented
* JWT hardening?
* **Rate-limit by IP** — track failed attempts in a small file or shared
  memory; after N failures in a window, reject quickly with no sleep.
  This replaces the previous 7-12 seconds rate limiter which a good
  defense against user enumeration via timing, but it holds a
  PHP-FPM / mod_php worker for 7–12 seconds.  Under any load, this is
  a trivial DoS vector.

***
* [x] trash local/remote simplification
* [x] move the pnm and getcompose to project root.
* [x] make use of the new keys from spa-config
* [x] API protocol on client
* [x] Soft-delete purge
  * Tombstones accumulate forever; no purge endpoint
* [x] Validate sync
  * Re-sync from scratch.  Check that sync perfomrance
* [x] On the top left icon, add a drop down with
  * SW.js refresh
  * Nuke IndexedDB offline cache and download
* [x] when offline can't login
  * start Firefox while server is down -> login prompt
* [x] when the app loads it is always complains that unsaved changes.
* [x] client doesn't track version IDs
  * No 3 way merge
  * No conflict or overwrite detection
* [x] PHP server logging
  * user auth's
  * read/write notes (id+version), by user
* [x] Handle multiple tabs with the same data: Dexie Live queries
* [x] Multiple tenant:
  * src/ts/db.ts
    * Storage keys configurable per instance
    * super(dbName) -> derived from meta tag or base path
  * src/ts/sync.php
    * REVISION_KEY configurable from instance-path
  * cookie path from Path=/ to Path=<instance-path>
  * SW cache name
* [x] change path from ../api/xxx to ../api/index.php/xxx
* [x] remove author data from frontmatter (first class citizen in the
  server metadata)
* [x] SpaConfig -- add a E2EE key, with True - Required, False - Not
  supported (i.e. Server needs to look in content) and, Null, supported
  but not enforced (client decides?)
* [x] same user using two device can create undetected conflict updates.
  This relates to the feature that collapes version ids.  If the user
  writes from device A, and later writes the same note to device B,
  the two versions get collapsed.
* [x] convert storage.php into a formal interface + class
* [x] git based storage alternative?
  * The aim is to replace github/0ink.net NacoWiki+Albatros
  * We could keep the current backend and simply export everything to
    github. And github can keep track of a differnt change history.
* [x] switch t vite based build
  * GOOD: HMR - run new code without reloading web app
  * GOOD: CSS bundling (is this better?)
  * GOOD: better service worker integration (really?)
  * GOOD: Unfies with vitest.
  * BAD: index.html moves to project root
  * BAD: sw.js needs rewrite
  * BAD: CSS needs to be moved from index.html <link> to JS
  * BAD: Different build structure.
  * BAD: php dev server still needed, but proxied via vite server
