# Markdown

Quick list of supported markup:

* WikiLinks
* Emoji's - markdown-it-emoji
* GFM Built-in
  * `~~` ~~strike-through~~ (del) or (s)
  * tables
* "\\" at the end of the line to generate a line break
*  Templating using [ETA](https://eta.js.org/)
  * Get variables from:
    * SpaConfig
    * Front matter
    * Include from other notes (Front matter and body)?
* TOC markdown-it-anchor + markdown-it-toc-done-right
* tasks lists - markdown-it-task-lists
* Tables with table span - markdown-it-multimd-table
* Popular Ecosystem plugins:
  * markdown-it-footnote
  * markdown-it-deflist
  * markdown-it-abbr
* Custom plugin
  * `++` ++insert++ (ins)
  * `^^` ^^superscript^^ (sup)
  * `,,` ,,subscript,, (sub)
  * `==` ==keyboard== (kbd)
  * `??` ??highlight?? (mark)

## Fenced code block renderers:

* syntax highlighting
* mermaid
* svgbob via wasm
* math equations (KaTex + AsciiMath)
* Custom PapaParser + formula engine


# Considered but Not implemented

* ~~Links ending with `^` will open in a new window.~~
* ~~YoutubeLinks~~
* ~~Includes~~, uses templating
* ~~headown~~
  - `#++` and `#--` is used to increment headown level.  (Use this in
    combination with file includes.
* Fenced code blocks
  * ~~viz-js/viz~~: Fenced code block renderer. Creates a 1.5 MB bundle!
    - graphviz-dot
    - graphviz-neato
    - graphviz-fdp
    - graphviz-sfdp
    - graphviz-twopi
    - graphviz-circo
* ~~chart~~: piecharts, barcharts, etc. from csv or xlsx
  (see previous) Use csv-chart or xlsx-chart?
* ~~DOMpurify~~: Sanitization, but right now HTML off by default



