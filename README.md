# Biserica Baptistă Harul — Website

Bilingual (RO/EN) static website for Grace Romanian Baptist Church, Sacramento, CA.
Live at https://graceromanianbaptistchurch.org (Cloudflare Pages, deployed from `main`).

## Structure
- `index.html`, `despre.html`, `events.html`, `sermons.html`, `calendar.html`, `board.html` — pages
- `site.js`, `styles.css` — behavior and styling (navy & burgundy, serif)
- `*.json` — editable content (events, sermons, board, settings, site text)
- `admin/`, `config.yml` — Decap CMS for non-technical editors
- `manifest.json`, `sw.js` — installable PWA + OneSignal push

## Editing content
Use the CMS at `/admin/`. Edits are saved as commits to the JSON files above.
