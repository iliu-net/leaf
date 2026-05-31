// Type declarations for .wasm files bundled by esbuild's binary loader.
// The binary loader inlines the WASM bytes as a Uint8Array default export.

declare module '*.wasm' {
  const bytes: Uint8Array;
  export default bytes;
}
