# Used Gear Finder

Local TypeScript web app that scrapes used listings for:

- Blue Fender Telecasters excluding `Squier`
- Line 6 HX Stomp excluding `HX Stomp XL`

Sources:

- eBay
- Reverb
- Guitar Center

## Run

```bash
npm install
npm run install:browsers
npm run dev
```

- Frontend: `http://localhost:5173`
- API/server: `http://localhost:8787`

## Build

```bash
npm run build
npm start
```

## Snapshot Build

Generate the static snapshot payload from saved local history:

```bash
npm run snapshot:generate
```

Refresh every preset live, update saved history, then write the snapshot payload:

```bash
npm run snapshot:refresh
```

Build the GitHub Pages snapshot site:

```bash
npm run build:snapshot
```

## Tests

```bash
npm test
```

## Live Smoke Check

```bash
npm run smoke
```

## Notes

- Results are cached in memory for 5 minutes by default.
- Saved search and compare history is written to `data/` and reused for 24 hours by default.
- Listings are ranked by visible total cost when shipping is available.
- Listings with unknown shipping stay visible but sort after listings with known totals.
- This is a local-only scraper. It does not use logins or attempt CAPTCHA bypass.
- A GitHub Pages workflow is included under `.github/workflows/pages.yml` for daily snapshot deploys.
