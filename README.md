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

- `npm run refresh:conditions` — refresh `src/data/{weather,tides}.json`. Runs automatically every 3h via `.github/workflows/refresh-conditions.yml`.
