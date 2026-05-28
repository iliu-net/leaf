// Type declarations for highlight.js subpath imports.
// The package's exports map routes lib/core → es/core and
// lib/languages/* → es/languages/* at runtime, but TS bundler
// resolution doesn't pick up the adjacent .d.ts files.

declare module 'highlight.js/lib/core' {
  import type { HLJSApi } from 'highlight.js';
  const hljs: HLJSApi;
  export default hljs;
}

declare module 'highlight.js/lib/languages/*' {
  const fn: object;
  export default fn;
}
