# ECC Scheduler Calendar (Vite + React + TypeScript)

This scheduling app is powered by live Teamup data through the Cloudflare Worker proxy at `https://pevs.hicksrch.workers.dev`.

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

- The frontend only requests Teamup events from the Worker endpoint:
  - `GET https://pevs.hicksrch.workers.dev/events?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&tz=America/Indiana/Indianapolis`
- The frontend does **not** call `https://api.teamup.com` directly.
- Teamup token and calendar key are injected server-side by the Worker, not exposed in browser code.
- If the Worker is unreachable, the UI shows a non-intrusive warning banner.

## Favicon

A bundled favicon is provided at `public/favicon.svg` and wired in `index.html` so browsers stop requesting a missing default `/favicon.ico`.

## Deployment base path

This project supports GitHub Pages subpath deployment through `vite.config.ts`.

Base path selection order:
- `BASE_URL` environment variable (recommended)
- `GITHUB_REPOSITORY` repo name (used automatically in GitHub Actions)
- `/` fallback for local development
