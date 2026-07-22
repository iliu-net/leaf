/**
 * svgbob.ts — ASCII diagram rendering via svgbob-wasm
 *
 * Plugin contract: default-export a function `(md, options?) => void`.
 *
 * On load:
 *   1. Registers a fence renderer for "bob" and "svgbob" language tags
 *      that wraps matching blocks with data-lang="svgbob" and
 *      base64-encoded source
 *   2. Registers a "svgbob" hydrator that lazy-loads svgbob-wasm
 *      and renders ASCII diagrams to inline SVG
 */

import type MarkdownIt from 'markdown-it';
import { registerFenceRenderer } from '../markdown.js';
import { registerHydrator } from '../fence-hydrate.js';
import { registerSystemNote } from '../system-notes/registry.js';
import svgbobDocs from './svgbob-docs.md';

registerSystemNote({
  id: '@help:markdown:svgbob',
  label: 'Svgbob Diagrams',
  content: () => svgbobDocs,
});

// ── Plugin entry point ─────────────────────────────────────────────────────

const plugin: (md: MarkdownIt, options?: any) => void = (_md, _opts) => {
  // No per-instance configuration needed — svgbob-wasm has no options
};

export default plugin;

// ── Fence renderer (bob / svgbob) ──────────────────────────────────────────
// Wraps fenced code blocks tagged "bob" or "svgbob" with data-lang and
// data-source so the hydrator can pick them up later.
// Registered on module load so the fence chain is set up before any
// markdown parsing happens.

registerFenceRenderer(['bob', 'svgbob'], (tokens, idx) => {
  const source = tokens[idx].content;
  const encoded = btoa(unescape(encodeURIComponent(source)));
  const escaped = tokens[idx].content; // already HTML-escaped by markdown-it
  return (
    `<pre><code class="language-svgbob"`
    + ` data-lang="svgbob" data-source="${encoded}">`
    + escaped
    + `</code></pre>`
  );
});

// ── Hydrator registration ──────────────────────────────────────────────────
//
// svgbob-wasm uses wasm-bindgen --target web.  Vite's ?url suffix
// resolves the .wasm file to a URL at build time.

registerHydrator('svgbob', async () => {
  // Dynamic import with ?url suffix → Vite returns the URL string.
  const wasmMod = await import('svgbob-wasm/svgbob_wasm_bg.wasm?url');
  const wasmUrl: string = wasmMod.default;
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Failed to fetch svgbob WASM: ${response.status}`);
  const wasmBytes = new Uint8Array(await response.arrayBuffer());

  // Instantiate the WASM module.  svgbob is a pure-compute module with
  // no host imports, so an empty import object suffices.
  // WebAssembly.instantiate(bufferSource, imports) returns
  // { module: Module, instance: Instance }.
  const wasmBuf = wasmBytes.buffer.slice(
    wasmBytes.byteOffset,
    wasmBytes.byteOffset + wasmBytes.byteLength,
  );
  const { instance: wasmInstance } =
    await WebAssembly.instantiate(wasmBuf as ArrayBuffer, {});
  const wasmExports = wasmInstance.exports as any;

  // ── wasm-bindgen runtime helpers ──────────────────────────────────────
  // These replicate the thin bindings from svgbob_wasm_bg.js so that the
  // render logic works against the raw WASM exports.

  const memory = wasmExports.memory as WebAssembly.Memory;

  function getUint8Mem(): Uint8Array {
    return new Uint8Array(memory.buffer);
  }

  function getInt32Mem(): Int32Array {
    return new Int32Array(memory.buffer);
  }

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

  // Pass a JS string into WASM linear memory; returns the byte offset.
  function passStringToWasm(s: string): [number, number] {
    const buf = textEncoder.encode(s);
    const ptr = wasmExports.__wbindgen_malloc(buf.length);
    getUint8Mem().set(buf, ptr);
    return [ptr, buf.length];
  }

  // Read a JS string out of WASM linear memory.
  function getStringFromWasm(ptr: number, len: number): string {
    return textDecoder.decode(getUint8Mem().subarray(ptr, ptr + len));
  }

  // ── Return the render function ────────────────────────────────────────

  return async (source: string) => {
    let r0 = 0;
    let r1 = 0;
    const stackTop = wasmExports.__wbindgen_add_to_stack_pointer(-16);
    try {
      const [ptr, len] = passStringToWasm(source);
      wasmExports.render(stackTop, ptr, len);
      const int32 = getInt32Mem();
      r0 = int32[stackTop / 4 + 0];
      r1 = int32[stackTop / 4 + 1];
      const svgStr = getStringFromWasm(r0, r1);
      return `<div class="svgbob-diagram">${svgStr}</div>`;
    } finally {
      wasmExports.__wbindgen_add_to_stack_pointer(16);
      wasmExports.__wbindgen_free(r0, r1);
    }
  };
});
