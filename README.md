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

## Data source policy

- The app ingests schedule data from Teamup only.
- PDF parsing and PDF-based ingestion pipelines have been removed.
- If Teamup is unreachable, the UI shows an unavailable warning instead of falling back to local seed data.
- Local edits are intentionally disabled until Teamup parity/migration is complete.

Optional environment variable:

- `VITE_TEAMUP_CALENDAR_KEY` (defaults to `ks109ec178962cdfa7`)

## Deployment base path

This project supports GitHub Pages subpath deployment through `vite.config.ts`.

Base path selection order:
- `BASE_URL` environment variable (recommended)
- `GITHUB_REPOSITORY` repo name (used automatically in GitHub Actions)
- `/` fallback for local development
