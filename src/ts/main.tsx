/**
 * main.tsx — React entry point.
 *
 * Replaces src/ts/app.ts as the Vite entry module.
 * Phase 1: renders the static app shell only.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.js';               // CSS bundle entry point
import './system-notes/builtin.js'; // side-effect: registers built-in system notes
import App from './components/App.js';

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
