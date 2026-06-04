---
title: Templates
edit-time: 1382
summary: Sample summary text
template: true
custom_key: hello world
template-deps: markdown:templates:fragment
item_list: one,two,three,four
---

In addition to [markdown](https://www.markdownguide.org/) markup,
[Leaf](https://github.com/iliu-net/leaf) has template support.

To enable templates you need to add to a note meta data:

* `template`: `true`
* Optionally, `template-deps` with a comma separated list
  of templates to include.

With that enable you can render the Frontmatter:

* title: "<%= $.meta.title %>"
* custom: "<%= $.meta.custom_key %>"

You can include a full note:

<%~ $.notes["markdown:templates:fragment"].body %>

The example is for example defining HTML and W3C abbreviations.
Or you can include frontmatter:
"<%= $.notes["markdown:templates:fragment"].meta.key1 %>"

You can render values from the server configuration:

`deleted_notes_ttl_days: <%= $.config.deleted_notes_ttl_days %>`

<% const x = Math.floor(Date.now()/1000); %>
<% if ((x % 2) == 0) { %>
x = <%= x %> is even.
<% } else { %>
x <%= x %> is odd.
<% } %>

<% $.meta.item_list.split(',').forEach(function(word) { %>
* <%= word %>.
<% }) %>


Dependencies:

* [[markdown:templates:fragment]]
