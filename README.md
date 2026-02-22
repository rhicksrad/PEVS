# ECC Scheduler Calendar (Vite + React + TypeScript)

This scheduling app is powered by live Teamup calendar data from `https://teamup.com/ks109ec178962cdfa7`.

## Run locally

```bash
pnpm i
pnpm dev
```

Other scripts:

```bash
pnpm build
pnpm preview
pnpm lint
```

### Local Teamup proxy route

When running `pnpm dev`, Vite now proxies Teamup feed requests from:

- `/api/teamup/feed/{calendarKey}/0.ics`

to Teamup's upstream ICS endpoint:

- `https://ics.teamup.com/feed/{calendarKey}/0.ics`

This prevents local 404s for `/api/teamup/...` and keeps browser requests same-origin while developing.

## Data source policy

- The app ingests schedule data from Teamup only.
- PDF parsing and PDF-based ingestion pipelines have been removed.
- If Teamup is unreachable, the UI shows an unavailable warning instead of falling back to local seed data.
- Local edits are intentionally disabled until Teamup parity/migration is complete.

Optional environment variable:

- `VITE_TEAMUP_CALENDAR_KEY` (defaults to `ks109ec178962cdfa7`)
- `VITE_TEAMUP_ICS_URL` (defaults in production to `/api/teamup/feed/{calendarKey}/0.ics`)

## Favicon

A bundled favicon is provided at `public/favicon.svg` and wired in `index.html` so browsers stop requesting a missing default `/favicon.ico`.

## Deployment base path

This project supports GitHub Pages subpath deployment through `vite.config.ts`.

Base path selection order:
- `BASE_URL` environment variable (recommended)
- `GITHUB_REPOSITORY` repo name (used automatically in GitHub Actions)
- `/` fallback for local development
