---
title: Markdown Support Demo
edit-time: 1539
---
[Leaf](https://github.com/iliu-net/leaf)

[toc]

Leaf supports [Markdown][md] with some extensions.  This
note shows example on the different rendering options.
Switch to ==CODE== mode to view how the markup looks like.

# Basic Rendering examples

Heading
=======

Sub-heading
-----------

# Alternative heading

## Alternative sub-heading

Paragraphs are separated 
by a blank line.

Two spaces  
or a backslash \
at the end of a line produce a line break.

Text attributes _italic_, **bold**, `monospace`.
Alternatively *italic*, __bold__.

Horizontal rule:

---

or

***


A [link](https://google.com).

![Image](https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Google_%22G%22_logo.svg/40px-Google_%22G%22_logo.svg.png)

> Markdown uses email-style
characters for blockquoting.
>
> Multiple paragraphs need to be prepended individually.

Normally 
<abbr title="Hypertext Markup Language">HTML</abbr>
tags would be supported, but [[@help:about|Leaf]] escapes
them by default.

# Extensions

## abbr

*[API]: Application Programming Interface

This note documents the API.

Abbreviations can be defined anywhere in your document.

## deflist

Term 1
: Definition of term 1

Term 2
~ Definition of term 2 (tilde variant)

Term
: First definition.
: Second definition.

## emoji

I :heart: Leaf

## footnote

Create a reference in the text with `[^label]`,
then define it anywhere in the document with
`[^label]: definition`:

Here is a footnote reference,[^1] and another.[^longnote]

[^1]: Here is the footnote.

[^longnote]: Here's one with multiple blocks.

    Subsequent paragraphs are indented to show that they
belong to the previous footnote.

## inline-extras

* ++inserted text++
* ^^superscript^^, E = mc^^2^^
* ,,Subscript,, H,,2,,O
* ==Keyboard Input==
* ??text highlight??

Because parser limitations, there may be some cave-as on how
this markup works.  Refer to the
[[@help:markdown:inline-extras|Documentation]] for the format.

## task-lists

* [ ] what to do?
* [X] upper case X
* [x] lower case x


## toc

Just use `[toc]` on a line.  See the top of this note.

## wikilinks

You can link notes [[welcome]] and
[[@help:about|system notes]] as well.





  [md]: https://www.markdownguide.org/
