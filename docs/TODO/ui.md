# UI Work

* [ ] History UI improvement
  * On-line only interface
  * Server already contains version and previous version link for all versions
    which can be used to create a DAG
  * Client can retrieve the version data and use that to visualize
    the DAG and highlight conflicts
  * Similar to git log --graph
  * Linear vs graph: Which one to use?
    * user preference or SpaConfig?
    * selected per desktop or mobile
* [ ] Conflict resolution UI via 3-way merge
  * all versions are saved (Conflict winners and losers) with links to
    previous versions.  Use this to determine a common ancestor and do
    a 3 way merge.
  * UI, select from History UI and generate a preview.  User can accept
    or cancel.
* Extend wikilinks
  * http:// or https:// will generate external links.  Last entries
    in autocomlete should be http:// or https:// and let the user type.
  * $ -> used for special embedding ... aborts autocompletion
    $yt: youtube embeds ~~not really needed, never really used this~~
    $gh-script: embed like gist shortcut
    <script src="https://tortugalabs.github.io/embed-like-gist/embed.js?style=github&showBorder=on&showLineNumbers=on&showFileMeta=on&showCopy=on&fetchFromJsDelivr=on&target=https://github.com/alejandroliu/0ink.net/blob/main/snippets/2024/optimiz/output.md"></script>
    $!media: embed a image from media library.  Could do auto completion
    if a API is available
    $media: add a link from media library.
    ![title]({static}/images/..path...) => image
    [title]({static}/images/..path...) => just a link
* Remove back button and use browser history instead

***

* [x] Left panel
  * Folder tree UI in sidebar with search
    * note IDs should allow a tree view similar to Windows File Manager
  * Can be hidden
* [x] tweak the UI for meta data editing and system meta rendering
* Views
  * [x] Rendered markdown (default)
    * test for inter node stuff.
  * [x] Frontmatter
    * Structured frontmatter editor
    * Metadata info
      * NodeRecord: create, updated
      * FrontMatter:
	* Authored by:
	* Revised by:
  * [x] CodeMirror Phase 1:
    * Markdown
    * Spellcheck
    * Lazy loaded, fallsback to raw if not available.
  * [x] CodeMirror Phase 2:
    * Paste images (img+src:data)
  * [x] TextArea
* [x] Trash UI
* [x] History UI
* [x] Implement Auto Save
* [x] Small UI tweaks
  * [x] Left Panel UI - SideBar can be resized.
  * [x] add an in-app back button
    * Close to the top left of the window.
  * [x] Add CTRL+E shortcut to go from VIEW TAB to CODE or RAW tab,
	add a different shortcut to go to the META TAB.  CODE or
	META tabs should grab focus when switched to.
  * [x] CodeMirror, autoSaves by default, CTRL+S saves but also switches
    to view tab.
  * [x] front matter render, after created/updated date by name, also
    show a relative time.
  * [x] Creating a new note, should select the note and make it ready
    to type.
  * [x] Should persist what was the last note opened.  The persistance
    should be on same origin, same path.  (Not just same origin).
* [x] Themeing
  * Light theme and the ability to switch themes via menu option on
    the logo menu. (Top left corner)
  * Split CSS into layout.css and theme.css. (Contaings colors and
    font typography and scaling)
  * Plan is base/dark/light themes.
* [x] Cookmode
  * NoSleep.js for iphone, or Screen Wakelock API
  * UI control to the right of status bar to prevent the screen from going to sleep.
  * For iPhone, NoSleep.js introduces limitations on how the UI should
    behave.
* [x] Note editing time tracking
  * store in frontmatter (becomes another of the RESERVED_KEYS)
  * Count when note is popen but stop timer with 5 minutes of
    inactivity (with SpaConfig override)
  * Is a vanity metric.
  * Low Priority
* [x] Code Tab, entry field at the top to allow editing of the note
  title.  Styled like a editable title.
* [x] Sidebar, expanding tree branches, I find the hitbox too small
* [x] Fixed application provided notes
  * similar to browser pattern of `about:config` URLs
  * Show application help
  * Show about leaf info (copyright, version, etc)
  * plugins can use to publish documentation
  * Settings and/or preferences panel?
  * These are shown at the end of the sidebar.
* [x] CodeMirror
  - **WikiLink autocomplete** in CodeMirror (`\[\[` triggers a completion dialog
    sourced from IndexedDB note list).
* [x] Search contents UI
  * modal, search across all the note contents, returns results in
    a modal. (Not sure)
  * needs discussion as there are several search scopes:
    * [x] search ID names
    * [x] search within current note -- Use CodeMirror functionality
    * [x] global search across all notes.  Enter in the search entry
      hit enter, trigger full search.
* [x] Completing Tag support
  * [x] AutoTag
    * Note with id _tagcloud contains a word to tag mapping.
    * When we save a note, before saving the note to Dexie
    * we check if it contains words in _tagcloud, if found
      we add the tag to auto-tags in Frontmatter.
    * When we merge user-tags + auto-tags, user-tags that contain !tag
      remove any matching auto-tags from the final set.
  * [x] Tags sidebar mode
    * List of tags, which when expanded show notes with those tags
* [x] Ctrl+E in system note should be disabled.
* [x] responsive design
  * desktop first. Sidebar collapses into a dropdown, editor tabs turn into a mode
    selector menu.
  * breakpoints to be decided within implementation.
  * Some visual issues still present.


***

* CodeMirror
  - ~~**WikiLink syntax highlighting** in the CodeMirror extension set (custom
    language extension that mirrors what `extensions/wikilinks.ts` does for
    the markdown-it renderer).~~
  - ~~**Canvas-based crop** in the image editor modal (freeform crop, aspect-ratio
    lock, circular crop for avatar-style images).~~
