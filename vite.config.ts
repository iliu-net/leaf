import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

// Resolve git version once, shared between define + the md-as-text plugin.
function gitVersion(): string {
  try {
    return execSync('git describe --always --dirty=-M', {
      encoding: 'utf-8',
      cwd: process.cwd(),
    }).trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig(({ command }) => ({
  // In dev mode, serve from a subpath matching production so that the
  // app's install-path logic (deriveInstallPath + ../api/) resolves
  // the API correctly.  LEAF_BASE env var picks the right path.
  // In production builds, use relative paths so the output can be
  // deployed to any directory without a <base> tag.
  base: command === 'serve'
    ? (process.env.LEAF_BASE || '/spa/')
    : './',

  define: {
    __APP_VERSION__: JSON.stringify(gitVersion()),
  },

  // Static assets copied verbatim to dist/ (icons, manifest.json).
  publicDir: 'spa',

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    // Stable entry filenames — index.html references leaf.js / leaf.css
    // which never change between builds, so per-instance index.html
    // copies don't need updating when the shared dist is rebuilt.
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/leaf.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || '';
          // Main CSS — stable name, no hash
          if (/\.css$/.test(name)) return 'assets/leaf.css';
          return 'assets/[name]-[hash].[ext]';
        },
      },
    },
  },

  plugins: [
    react(),
    // Check for duplicate system-note registrations at build time.
    // Scans all .ts/.tsx files under src/ — not just the module graph —
    // so duplicates in dead code are caught too.
    {
      name: 'check-system-note-ids',
      buildStart() {
        const srcDir = join(process.cwd(), 'src', 'ts');
        const seen = new Map<string, string[]>();
        const re = /registerSystemNote\(\s*\{[^}]*?\bid:\s*['"]([^'"]+)['"]/gs;

        function scanDir(dir: string) {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
              if (entry.name !== 'node_modules') scanDir(full);
            } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
              const code = readFileSync(full, 'utf-8');
              let m: RegExpExecArray | null;
              re.lastIndex = 0;
              while ((m = re.exec(code)) !== null) {
                const noteId = m[1];
                const files = seen.get(noteId) || [];
                files.push(relative(process.cwd(), full));
                seen.set(noteId, files);
              }
            }
          }
        }

        scanDir(srcDir);

        const dupes: string[] = [];
        for (const [noteId, files] of seen) {
          if (files.length > 1) {
            dupes.push(`  "${noteId}" registered in:\n${files.map(f => `    ${f}`).join('\n')}`);
          }
        }
        if (dupes.length > 0) {
          this.error(`Duplicate system-note IDs detected:\n${dupes.join('\n')}`);
        }
      },
    },
    // Import .md files as text strings (esbuild --loader:.md=text equivalent).
    // Also replaces <DEVELOPMENT> with git describe so system notes like
    // about.md can show the build version.
    {
      name: 'md-as-text',
      transform(code, id) {
        if (!id.endsWith('.md')) return;
        if (code.includes('<DEVELOPMENT>')) {
          code = code.replaceAll('<DEVELOPMENT>', gitVersion());
        }
        return `export default ${JSON.stringify(code)};`;
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,ttf,wasm,json}'],
        runtimeCaching: [
          // Auth and spa-config → network only (matches current SW).
          { urlPattern: /\/api\/.*\/(auth|spa-config)/, handler: 'NetworkOnly' },
          // Other API calls → network only, no caching.
          { urlPattern: /\/api\/.*/, handler: 'NetworkOnly' },
        ],
      },
      includeAssets: ['icons/icon-192.svg', 'icons/icon-512.svg'],
      manifest: false,  // we serve our own manifest.json
    }),
    // Bundle visualizer — outputs stats.html on build (skip in dev)
    ...(command === 'build'
      ? [visualizer({
          filename: 'dist/stats.html',
          open: false,
          gzipSize: true,
          brotliSize: true,
        })]
      : []),
  ],

  server: {
    proxy: {
      '/api':      process.env.API_PROXY_TARGET || 'http://localhost:9000',
      '/demo/api': process.env.API_PROXY_TARGET || 'http://localhost:9000',
    },
  },
}));
