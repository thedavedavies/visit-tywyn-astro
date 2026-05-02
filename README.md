# Visit Tywyn — Astro

Static rebuild of [visit-tywyn.co.uk](https://visit-tywyn.co.uk), migrated
from WordPress to Astro 6.

## Getting started

Requires Node 22.12+.

```bash
npm install
npm run dev
```

## Useful scripts

- `npm run export` — regenerate `src/content/**` and `public/_redirects` from the WP SQL dump (path in `tools/export-from-sql.ts`).
- `npm run migrate:uploads` — copy referenced images from the legacy backup into `public/img/` (gitignored, ~50MB).
- `npm run refresh:conditions` — refresh `src/data/{weather,tides}.json`. Runs automatically every 3h via `.github/workflows/refresh-conditions.yml`.
