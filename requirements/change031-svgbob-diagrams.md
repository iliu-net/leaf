# Change 031 — Svgbob ASCII diagram renderer

## Summary

Add svgbob as a fenced code block renderer, converting ASCII-art diagrams
into inline SVG via a lazy-loaded WebAssembly module.

## Motivation

Users frequently sketch diagrams in their notes — architecture boxes,
flowcharts, sequence diagrams.  Raw ASCII art is readable but visually
unpolished.  Svgbob converts these sketches to clean SVG graphics at
view time, keeping the source as editable plain text.

## Usage

````markdown
```bob
  ┌──────────┐       ┌──────────┐
  │  Client  │ ────> │  Server  │
  └──────────┘       └──────────┘
```
````

Either `bob` or `svgbob` can be used as the language tag.  The ASCII
source remains the editable content; rendering to SVG happens in the
View tab only.

## Architecture

| Layer | Mechanism |
|---|---|
| Fence renderer | Matches `bob` / `svgbob` blocks, wraps with `data-lang="svgbob"` and base64-encoded source |
| Hydrator | Lazy-loads `svgbob-wasm`, instantiates the WASM module manually via `WebAssembly.instantiate`, provides wasm-bindgen compatible string marshalling |
| Loading | The ~450 KB WASM binary is code-split and only fetched when the first diagram block is encountered |

The hydrator replicates the thin wasm-bindgen runtime from `svgbob_wasm_bg.js`
because esbuild's binary loader embeds the WASM bytes as a `Uint8Array` rather
than supporting wasm-bindgen's `--target web` module import pattern.

## Files changed

| File | Change |
|---|---|
| `src/ts/extensions/svgbob.ts` | New plugin: fence renderer + hydrator + system-note registration |
| `src/ts/extensions/svgbob-docs.md` | Help documentation |
| `src/ts/extensions/wasm.d.ts` | TypeScript declaration for `*.wasm` binary imports |
| `src/ts/markdown.ts` | Added `svgbob` to plugin registry |
| `package.json` | Added `svgbob-wasm` dependency; `--loader:.wasm=binary` to esbuild |

## Configuration

No options required.  Activate by adding `"svgbob"` to `markdown.plugins`:

```json
{
  "markdown": {
    "plugins": [["highlight", "common"], "svgbob"]
  }
}
```
