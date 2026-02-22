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


## Data mapping policy

- Teamup events are mapped to app schedule events with source metadata (`source`, `calendarLabel`, and context) so validation can identify mapping gaps.
- Owner/person mapping is validated for Teamup imports. If a Teamup event has no mapped owner and is not in an approved non-person context, the app emits a warning such as: `Owner not mapped for Teamup event "X" (calendar "Y")`.
- Explicit non-person allowlist contexts are intentionally limited to reduce noise (currently `General Events` and `ECC Resident Chief`).
- Owner mapping warnings are shown in the in-app validation banner and logged via existing validation issue handling.

## Favicon

A bundled favicon is provided at `public/favicon.svg` and wired in `index.html` so browsers stop requesting a missing default `/favicon.ico`.

## Deployment base path

This project supports GitHub Pages subpath deployment through `vite.config.ts`.

Base path selection order:
- `BASE_URL` environment variable (recommended)
- `GITHUB_REPOSITORY` repo name (used automatically in GitHub Actions)
- `/` fallback for local development
