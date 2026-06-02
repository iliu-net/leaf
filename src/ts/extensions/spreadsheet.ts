/**
 * spreadsheet.ts — CSV spreadsheet rendering via PapaParse + hot-formula-parser
 *
 * Plugin contract: default-export a function `(md, options?) => void`.
 *
 * Fenced code blocks tagged `spreadsheet` or `calc` are parsed as CSV,
 * formula cells (starting with `=`) are evaluated, and the result is
 * rendered as a static HTML table.
 *
 * On load:
 *   1. Registers fence renderers for "spreadsheet" / "calc" language tags
 *   2. Registers a hydrator that lazy-loads PapaParse and hot-formula-parser
 *      and renders the spreadsheet
 */

import type MarkdownIt from 'markdown-it';
import { registerFenceRenderer } from '../markdown.js';
import { registerHydrator } from '../fence-hydrate.js';
import { registerSystemNote } from '../system-notes/registry.js';
import spreadsheetDocs from './spreadsheet-docs.md';

registerSystemNote({
  id: '@help:markdown:spreadsheet',
  label: 'Spreadsheet Blocks',
  content: () => spreadsheetDocs,
});

// ── Plugin entry point ─────────────────────────────────────────────────────

const plugin: (md: MarkdownIt, options?: any) => void = (_md, _opts) => {
  // No per-instance configuration needed
};

export default plugin;

// ── Fence renderer ─────────────────────────────────────────────────────────
// Registered on module load so the fence chain is set up before any
// markdown parsing happens.

registerFenceRenderer(['spreadsheet', 'calc'], (tokens, idx) => {
  const source = tokens[idx].content;
  const encoded = btoa(unescape(encodeURIComponent(source)));
  const escaped = tokens[idx].content; // already HTML-escaped by markdown-it
  const lang = tokens[idx].info.trim().split(/\s+/)[0];
  return (
    `<pre><code class="language-${lang}"`
    + ` data-lang="spreadsheet" data-source="${encoded}">`
    + escaped
    + `</code></pre>`
  );
});

// ── Spreadsheet engine ─────────────────────────────────────────────────────
// All functions must be defined before the hydrator registration below,
// since the hydrator callback captures and calls renderSpreadsheet().

/** Represents one cell in the grid. */
interface Cell {
  raw: string;
  value: string;       // resolved value (as string for display)
  isFormula: boolean;
  formula: string;     // without leading "=", only set when isFormula
}

/** Convert a column index to A1-style letters.  0→A, 25→Z, 26→AA, … */
function colLabel(index: number): string {
  let label = '';
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** Parse an A1-style column label back to a zero-based index. */
function colIndex(label: string): number {
  let idx = 0;
  for (let i = 0; i < label.length; i++) {
    idx = idx * 26 + (label.toUpperCase().charCodeAt(i) - 64);
  }
  return idx - 1;
}

/** Parse a cell reference like "A1" or "BZ42" into {col, row} (0-based). */
function parseCellRef(ref: string): { col: number; row: number } | null {
  const m = ref.match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return null;
  return { col: colIndex(m[1]), row: parseInt(m[2], 10) - 1 };
}

/**
 * Extract all cell references and range references from a formula string.
 */
function extractRefs(formula: string): {
  singleRefs: string[];
  rangeRefs: Array<{ start: string; end: string }>;
} {
  const rangePat = /(\$?[A-Za-z]+\$?\d+)\s*[:.]\s*(\$?[A-Za-z]+\$?\d+)/g;
  const rangeRefs: Array<{ start: string; end: string }> = [];

  let rangeMatch: RegExpExecArray | null;
  while ((rangeMatch = rangePat.exec(formula)) !== null) {
    const start = rangeMatch[1].replace(/\$/g, '');
    const end = rangeMatch[2].replace(/\$/g, '');
    rangeRefs.push({ start, end });
  }

  // Find individual cell refs that are NOT the start/end of a range
  const cellPat = /[A-Za-z]+\d+/g;
  const stripped = formula.replace(rangePat, '');
  const singleRefs: string[] = [];
  let cellMatch: RegExpExecArray | null;
  while ((cellMatch = cellPat.exec(stripped)) !== null) {
    const ref = cellMatch[0];
    let inRange = false;
    for (const rr of rangeRefs) {
      if (ref === rr.start || ref === rr.end) {
        inRange = true;
        break;
      }
    }
    if (!inRange && !/^\d+$/.test(ref)) {
      singleRefs.push(ref);
    }
  }

  return { singleRefs, rangeRefs };
}

/**
 * Expand a range like "A1:C3" into an array of individual cell references.
 */
function expandRange(start: string, end: string): string[] {
  const s = parseCellRef(start);
  const e = parseCellRef(end);
  if (!s || !e) return [];

  const refs: string[] = [];
  const minCol = Math.min(s.col, e.col);
  const maxCol = Math.max(s.col, e.col);
  const minRow = Math.min(s.row, e.row);
  const maxRow = Math.max(s.row, e.row);
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      refs.push(`${colLabel(c)}${r + 1}`);
    }
  }
  return refs;
}

/**
 * Resolve all cell/range references in a formula into concrete values,
 * returning an expression that hot-formula-parser can evaluate.
 *
 * Returns null if any referenced cell hasn't been resolved yet.
 */
function resolveExpression(
  formula: string,
  grid: Cell[][],
): string | null {
  let expr = formula;
  if (expr.startsWith('=')) {
    expr = expr.slice(1);
  }

  const { singleRefs, rangeRefs } = extractRefs(expr);

  // ── Step 1: validate all referenced cells exist and are resolved ──────

  // Track which individual cell refs belong to a range so we don't
  // double-replace them.
  const rangeCellRefs = new Set<string>();

  for (const { start, end } of rangeRefs) {
    const expanded = expandRange(start, end);
    for (const ref of expanded) {
      const pos = parseCellRef(ref);
      if (!pos || pos.row < 0 || pos.row >= grid.length ||
          pos.col < 0 || pos.col >= (grid[pos.row]?.length ?? 0)) {
        return null;
      }
      const cell = grid[pos.row][pos.col];
      if (cell.value.startsWith('=')) return null; // unresolved
      rangeCellRefs.add(ref);
    }
  }

  for (const ref of singleRefs) {
    const pos = parseCellRef(ref);
    if (!pos || pos.row < 0 || pos.row >= grid.length ||
        pos.col < 0 || pos.col >= (grid[pos.row]?.length ?? 0)) {
      return null;
    }
    const cell = grid[pos.row][pos.col];
    if (cell.value.startsWith('=')) return null; // unresolved
  }

  // ── Step 2: replace ranges FIRST (before individual refs) ────────────
  // This prevents individual cell refs like "A1" from matching inside
  // range tokens like "A1:A3".

  let resolved = expr;

  for (const { start, end } of rangeRefs) {
    const expanded = expandRange(start, end);
    const values = expanded.map(ref => {
      const pos = parseCellRef(ref)!;
      const v = grid[pos.row][pos.col].value;
      const num = Number(v);
      return !isNaN(num) && String(num) === v.trim()
        ? String(num)
        : `"${v.replace(/"/g, '\\"')}"`;
    });
    // Replace the range token (e.g., "A1:A3") with comma-separated values
    const rangeToken = `${start}:${end}`;
    // Escape special regex chars in the range token for literal match
    const escaped = rangeToken.replace(/([.*+?^${}()|[\]\\])/g, '\\$1');
    resolved = resolved.replace(new RegExp(escaped, 'g'), values.join(', '));
  }

  // ── Step 3: replace standalone cell refs ─────────────────────────────
  // Filter out refs that were already consumed by a range expansion.
  const standaloneRefs = singleRefs.filter(r => !rangeCellRefs.has(r));

  if (standaloneRefs.length > 0) {
    // Build replacements, longest refs first for safety
    const replacements: Array<{ ref: string; value: string }> = [];
    for (const ref of standaloneRefs) {
      const pos = parseCellRef(ref)!;
      const v = grid[pos.row][pos.col].value;
      const num = Number(v);
      replacements.push({
        ref,
        value: !isNaN(num) && String(num) === v.trim()
          ? String(num)
          : `"${v.replace(/"/g, '\\"')}"`,
      });
    }
    replacements.sort((a, b) => b.ref.length - a.ref.length);

    for (const { ref, value } of replacements) {
      const re = new RegExp(
        `(?<![A-Za-z0-9"])${ref.replace(/([.*+?^${}()|[\]\\])/g, '\\$1')}(?![A-Za-z0-9"])`,
        'gi',
      );
      resolved = resolved.replace(re, value);
    }
  }

  return resolved;
}

/**
 * Evaluate all formula cells in the grid using iterative resolution.
 */
function evaluateFormulas(grid: Cell[][], Parser: any): void {
  const MAX_PASSES = 50;

  const formulaCells: Array<{ row: number; col: number }> = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c].isFormula) {
        formulaCells.push({ row: r, col: c });
      }
    }
  }

  if (formulaCells.length === 0) return;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let progress = false;

    for (const { row, col } of formulaCells) {
      const cell = grid[row][col];
      if (!cell.isFormula || !cell.value.startsWith('=')) continue;

      const expr = resolveExpression(cell.formula, grid);
      if (expr === null) continue; // dependencies not ready

      try {
        const parser = new Parser();
        const result = parser.parse(expr);
        if (result.error) {
          cell.value = `#${result.error}`;
        } else if (result.result === null || result.result === undefined) {
          cell.value = '';
        } else {
          cell.value = String(result.result);
        }
        cell.isFormula = false;
        progress = true;
      } catch {
        cell.value = '#ERROR!';
        cell.isFormula = false;
        progress = true;
      }
    }

    if (!progress) break;
  }

  // Mark still-unresolved formulas
  for (const { row, col } of formulaCells) {
    const cell = grid[row][col];
    if (cell.isFormula && cell.value.startsWith('=')) {
      cell.value = '#UNRESOLVED!';
      cell.isFormula = false;
    }
  }
}

/**
 * Parse CSV text into a Cell grid using PapaParse.
 */
function buildGrid(csv: string, papaParse: (csv: string, opts?: any) => any): Cell[][] {
  const result = papaParse(csv.trim(), {
    header: false,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  const rows: any[][] = result.data ?? [];
  if (rows.length === 0) return [];

  const maxCols = Math.max(...rows.map(r => Array.isArray(r) ? r.length : 0));
  const grid: Cell[][] = [];

  for (const row of rows) {
    const cells: Cell[] = [];
    const arr = Array.isArray(row) ? row : [];
    for (let c = 0; c < maxCols; c++) {
      const raw = c < arr.length ? String(arr[c] ?? '') : '';
      const trimmed = raw.trim();
      const isFormula = trimmed.startsWith('=');
      cells.push({
        raw,
        value: isFormula ? trimmed : raw,
        isFormula,
        formula: isFormula ? trimmed : '',
      });
    }
    grid.push(cells);
  }

  return grid;
}

/**
 * Build an HTML table from the resolved grid.
 */
function buildTable(grid: Cell[][]): string {
  if (grid.length === 0)
    return '<div class="spreadsheet-empty">(empty)</div>';

  // Heuristic: first row is a header if all cells are non-empty text
  // and at least one cell in the second row is numeric/formula
  const hasHeader = grid.length > 1 &&
    grid[0].every(c => {
      const v = c.raw.trim();
      return v !== '' && isNaN(Number(v));
    }) &&
    grid[1].some(c => {
      const v = c.raw.trim();
      return v === '' || !isNaN(Number(v)) || v.startsWith('=');
    });

  const startRow = hasHeader ? 1 : 0;

  let html = '<div class="spreadsheet-wrap"><table class="spreadsheet-table">';

  // Column header row (A, B, C…)
  html += '<thead><tr><th class="ss-row-header"></th>';
  for (let c = 0; c < grid[0].length; c++) {
    html += `<th class="ss-col-header">${colLabel(c)}</th>`;
  }
  html += '</tr></thead>';

  html += '<tbody>';

  // CSV header row
  if (hasHeader) {
    html += '<tr>';
    html += '<th class="ss-row-header">1</th>';
    for (let c = 0; c < grid[0].length; c++) {
      html += `<th class="ss-data-header">${esc(grid[0][c].raw)}</th>`;
    }
    html += '</tr>';
  }

  // Data rows
  for (let r = startRow; r < grid.length; r++) {
    html += '<tr>';
    html += `<td class="ss-row-header">${r + 1}</td>`;
    for (let c = 0; c < grid[r].length; c++) {
      const cell = grid[r][c];
      let cls = '';
      if (cell.value.startsWith('#')) {
        cls = ' class="ss-error"';
      } else if (cell.raw.trim().startsWith('=')) {
        cls = ' class="ss-formula"';
      }
      html += `<td${cls}>${esc(cell.value)}</td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  return html;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Main entry point: parse CSV, evaluate formulas, return HTML table.
 */
function renderSpreadsheet(
  source: string,
  papaParse: (csv: string, opts?: any) => any,
  Parser: any,
): string {
  const grid = buildGrid(source, papaParse);
  evaluateFormulas(grid, Parser);
  return buildTable(grid);
}

// ── Hydrator registration ──────────────────────────────────────────────────
// PapaParse (~20 KB) and hot-formula-parser (~60 KB) are dynamically
// imported only when at least one spreadsheet block exists.

registerHydrator('spreadsheet', async () => {
  const [Papa, hfParser] = await Promise.all([
    import('papaparse'),
    import('hot-formula-parser'),
  ]);
  // esbuild CJS→ESM interop: the default export wraps the real API
  const papaParse: (csv: string, opts?: any) => any =
    (Papa as any).default?.parse ?? Papa.default?.parse ?? (Papa as any).parse;
  const Parser = (hfParser as any).default?.Parser ?? hfParser.Parser;

  return async (source: string): Promise<string> => {
    return renderSpreadsheet(source, papaParse, Parser);
  };
});
