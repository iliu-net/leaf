# Change 025 — Cookmode (Screen Wake Lock)

## Summary

Added a ☀ toggle button in the status bar that prevents the device screen
from sleeping using the browser's Screen Wake Lock API. Primarily useful
on mobile/tablet (recipes, reference material, sheet music) but works on
desktop Chromium browsers that honour the API.

Always starts **OFF** — no persistence. The user must explicitly enable
it with a click each session.

All actions and failures are logged to the console with a `[cookmode]`
prefix for debugging.

## Files created

- `src/ts/cookmode.ts` — wake lock module. Manages a `WakeLockSentinel`,
  handles visibility-change re-acquisition, exposes `enable()` / `disable()`
  / `toggle()` / `isActive()` / `updateButton()`.

## Files modified

### `src/ts/dom-ids.ts`
- Added `BTN_COOKMODE: 'btn-cookmode'` constant.

### `spa/index.html`
- Added `<button id="btn-cookmode">☀</button>` in the status bar,
  right of the sync-status indicator.

### `spa/css/layout.css`
- `#btn-cookmode` — no border, no background, dimmed at 40% opacity.
  `:hover` at 70%. `.active` at 100% (full brightness when wake lock
  is held).

### `src/ts/ui.ts`
- Imported `cookmode` module and `$maybe` from dom-ids.
- Wired click handler on `#btn-cookmode`: calls `cookmode.toggle()`,
  syncs button class, `aria-pressed`, title, and status bar message.
- Logs toggle action to console.

## Architecture

```
src/ts/cookmode.ts          ← wake lock logic (no DOM deps except updateButton)
src/ts/ui.ts → bindEvents   ← wires button click, calls cookmode.toggle()
spa/index.html              ← static button in status bar
spa/css/layout.css          ← button styling (opacity-based active state)
```

Toggle flow:
1. User clicks ☀ in status bar → `cookmode.toggle()`
2. `enable()` calls `navigator.wakeLock.request('screen')`
3. On success: `WakeLockSentinel` stored, button goes full-opacity,
   status bar shows "Cookmode: screen will stay awake"
4. On OS release (tab switch, etc.): `release` event fires →
   auto-re-acquire on next `visibilitychange` to `visible`
5. User clicks again → `disable()` → `wakeLock.release()`

Graceful fallback:
- `navigator.wakeLock` absent (Firefox, Safari) → logged to console,
  returns `false`, button state unchanged. No errors thrown.
