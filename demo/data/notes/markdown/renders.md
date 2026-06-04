---
title: Markdown Fenced Code Block Renderers
edit-time: 453
---
In addition to [markdown][md] markup, [Leaf][leaf] has 
fenced code block rendering extensions that can
apply custom rendering to fenced code blocks.  Generic 
example:

````markdown
```renderer

custom rendered content
```
````

```python
print("hello world")
```
The default is simply to highlight output, but the following
are available:

* [[markdown:renders:mermaid|Mermaid]]
* [[markdown:renders:mathjax|MathJax]]
* [[markdown:renders:spreadsheet|Spreadsheet]]
* [[markdown:renders:svgbob|Lineart]]



  [md]: https://www.markdownguide.org/
  [leaf]: https://github.com/iliu-net/leaf
