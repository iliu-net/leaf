# Known Limitations

* **Per-user revision tracking** \
  Single `notes_sync_revision` in localStorage — multi-account on
  same browser would conflict
* **Multi-user note isolation** \
  All users share one note set (collaborative by design)
* **CodeMirror Spellcheck** \
  Setting the spellcheck language from Frontmatter meta data doesn't
  seem to work.  You can of course right click on CodeMirror and
  select a different language.
* **Trashcan view transitions** \
  Sometimes, if you switch to the Trash view, and preview a note,
  the note stays.  So, if you select the Folder or Tag view, it
  will still display the Trash preview.  The Live note will be
  shown **underneath** the trash preview.  It doesn't always do
  this.




