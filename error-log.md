# Error Log — Just For Jess

---

## Session: 2026-06-11 — PWA Support

### What was built
Added full Progressive Web App support: manifest, service worker, app icons, notification scheduling, and iOS install prompt.

### Errors encountered

| # | Error | Resolution |
|---|---|---|
| 1 | `node: command not found` — JS syntax check attempted with Node.js, not installed | Switched to Python brace/paren balance check; both script blocks passed |

### Errors not encountered (things that worked first time)
- Pillow icon generation — ✦ rendered correctly via Georgia font (no fallback needed)
- All 5 `index.html` edits applied cleanly with no conflicts
- Service worker, manifest, and notification JS — no syntax issues detected

### Notes
- `generate_icons.py` only needs to be re-run if the icon design changes
- iOS push notifications require the PWA to be installed to the home screen first
- The `jj_notif_time` key in localStorage stores the user's chosen notification time
- The `jj_dismissed_install` key in localStorage stores whether the iOS install banner was dismissed

---

## Session: 2026-06-16 — Data Architecture Refactor

### What was built
Moved all SVG icons and card data out of HTML files into `cards.json`. Both `index.html` and `overview.html` now fetch `cards.json` at load time. `renderCard` in `index.html` was updated to use inline `background` styles (hex colours) instead of CSS class names, with luminance-based text/icon colour selection.

### Errors encountered

| # | Error | Resolution |
|---|---|---|
| 1 | Python edit script used wrong search anchor for CARDS block — found `let CARDS = [];` (newly added line) instead of the old 8-card array, causing SPECIAL DATES section to be duplicated in output | Fixed with a second cleanup script (`patch_index2.py`) that found the duplicate by its second occurrence and removed both it and the orphaned CARD DATA block |
| 2 | PowerShell interpolated `${` inside Python one-liners, causing parse errors | Moved all Python code to `.py` script files and ran them with `python <file>`, avoiding shell interpolation |
| 3 | `node: command not found` during planned JS syntax check | Used Python brace/paren balance check instead (same approach as Session 2026-06-11) |

### Errors not encountered (things that worked first time)
- `cards.json` restructure via Python (icons extracted from overview.html using regex on backtick strings) — worked cleanly, 68 icons extracted
- overview.html ICONS removal — worked first time
- loadCards() update — worked first time
- Boot section async refactor — worked first time
- deck-bg-dot BG_SWATCHES fallback — worked first time

### Files changed
- `cards.json` — restructured from flat array to `{ "icons": {...68 SVGs...}, "cards": [...105 cards...] }`
- `index.html` — removed hardcoded `ICONS`/`CARDS`, added `loadData()` async fetch, updated `renderCard` to inline hex styles, updated deck-bg-dot fallback
- `overview.html` — removed hardcoded `ICONS` block (~87KB), updated `loadCards()` to parse new structure

### Upload to GitHub required
`index.html`, `overview.html`, `cards.json`
