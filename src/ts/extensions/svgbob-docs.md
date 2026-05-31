---
title: Svgbob Diagrams
---

# Svgbob Diagrams

The svgbob plugin renders ASCII diagrams as SVG graphics using
[svgbob-wasm](https://github.com/agoose77/svgbob-wasm), a WebAssembly
build of [svgbob](https://github.com/ivanceras/svgbob).

## Usage

Use fenced code blocks with the `bob` or `svgbob` language tag:

````markdown
```bob
  ┌──────┐       ┌──────┐
  │ Leaf │ ────> │  DB  │
  └──────┘       └──────┘
```
````

## Configuration

No configuration options are required.  Add `"svgbob"` to the
`markdown.plugins` list in your spa-config:

```json
{
  "markdown": {
    "plugins": ["svgbob"]
  }
}
```

## Supported elements

Svgbob supports a wide range of ASCII art primitives including
boxes, lines, arrows, labels, and more.  See the
[svgbob documentation](https://ivanceras.github.io/svgbob-editor/)
for a full reference.
