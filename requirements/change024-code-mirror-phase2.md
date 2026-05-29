# CodeMirror Editor Integration

## Phase 2 — Paste handling

### 2a. `text/html` → Markdown via turndown

**`codemirror/paste-handler.ts`** intercepts the `paste` event on the CM
view DOM:

1. Check `clipboardData.types` for `text/html`.
2. `await import('turndown')` (lazy-loaded on first html paste).
3. Convert HTML to Markdown.
4. Insert the result at the cursor with `view.dispatch(replaceSelection(md))`.
5. If turndown fails to load, let the default paste handler take over (it
   will use `text/plain` as fallback).

### 2b. `image/*` → `<img src="data:..." />`

Same `paste` interceptor:

1. Check `clipboardData.items` for `image/*`.
2. Extract the `Blob`.
3. Open the **image editor modal** (`image-editor.ts`).
4. User confirms → modal returns a `data:` URL.
5. Insert `![alt](data:image/png;base64,...)` at the cursor.

### 2c. Image editor modal (MVP)

- Receive a `Blob`, load into an offscreen `HTMLImageElement`.
- Compute a display size: **max 640×480, preserve aspect ratio**.
- Render preview on a `<canvas>`.
- Modal UI: preview image, width + height inputs (pre-filled, editable to
  override the computed size), OK / Cancel buttons.
- On OK: draw the canvas at the chosen size, return `canvas.toDataURL()`.
- Designed so that a crop widget (e.g. cropperjs or hand-rolled canvas crop)
  can be added later without changing the paste-handler contract.

**Edge cases:**
- User closes the modal → no insertion, paste event discarded.
- Very large images — the on-screen preview is capped; the data URI uses the
  user-chosen dimensions so the final inserted image is never bigger than
  what the user saw.

## Post Phase 2 - Addendum

* Test cases

