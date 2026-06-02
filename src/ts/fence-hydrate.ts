/**
 * fence-hydrate.ts — async hydration of fenced code block placeholders
 *
 * After markdown-it renders HTML synchronously, this module walks the DOM
 * for <code> elements with [data-lang] attributes and replaces their
 * content with rendered output (diagrams, syntax-highlighted code, etc.).
 *
 * Each renderer is lazy-loaded via dynamic import() and is only fetched
 * when at least one matching code block exists on the page.
 */

// ── Hydrator registry ──────────────────────────────────────────────────────

type HydrateFn = (source: string, el: HTMLElement) => Promise<string>;

const _hydrators: Record<string, () => Promise<HydrateFn>> = {};

/**
 * Register a hydrator for a given language tag.
 *
 * `factory` is a lazy loader — called once when the first matching block
 * is encountered.  Must return a function that converts source text to
 * rendered HTML/SVG.
 */
export function registerHydrator(
  lang: string,
  factory: () => Promise<HydrateFn>,
): void {
  _hydrators[lang] = factory;
}

// ── Hydration ──────────────────────────────────────────────────────────────

/**
 * Find all code-block placeholders inside `root` and replace them with
 * asynchronously rendered output.
 *
 * Safe to call on any element — returns immediately if no placeholders
 * are found (zero overhead when no fence renderers are active).
 */
export async function hydrate(root: Element): Promise<void> {
  const placeholders = root.querySelectorAll<HTMLElement>(
    'code[data-lang]',
  );
  if (placeholders.length === 0) return;

  // Group by language so each renderer is loaded only once
  const byLang = new Map<string, HTMLElement[]>();
  for (const el of placeholders) {
    const lang = el.dataset.lang!;
    if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang)!.push(el);
  }

  for (const [lang, els] of byLang) {
    const factory = _hydrators[lang];
    if (!factory) continue;  // no renderer registered → leave as plain code

    try {
      const renderFn = await factory();
      for (const el of els) {
        try {
          const raw = el.dataset.source;
          if (!raw) continue;
          const source = decodeURIComponent(escape(atob(raw)));
          el.innerHTML = await renderFn(source, el);
          el.classList.add('hljs'); // mark as rendered
        } catch (err) {
          console.warn(`[hydrate] failed to render ${lang} block:`, err);
        }
      }
    } catch (err) {
      console.warn(`[hydrate] failed to load hydrator for "${lang}":`, err);
    }
  }
}
