# What is Ana's schedule?

This is a focused, personal view of Ana's work schedule. It answers whether Ana is working now, shows her next scheduled item, and presents her upcoming work in a simple timeline. The site intentionally omits the old calendar, team filters, analytics, and every other person's schedule.

Live data comes from Teamup through the Cloudflare Worker proxy at `https://pevs.hicksrch.workers.dev`. The UI only retains and renders events mapped to Ana's source calendar (`Ana Aghili`).

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


## Ana-only data policy

- The worker may return several source calendars, but the app filters normalized events before they enter UI state or browser cache.
- Only events resolved to Ana's canonical source name are retained.
- Team and source-calendar names are never rendered in the interface.
- A last-known Ana-only copy is cached for a friendlier offline fallback.

## Favicon

A bundled favicon is provided at `public/favicon.svg` and wired in `index.html` so browsers stop requesting a missing default `/favicon.ico`.

## Deployment base path

This project supports GitHub Pages subpath deployment through `vite.config.ts`.

Base path selection order:
- `BASE_URL` environment variable (recommended)
- `GITHUB_REPOSITORY` repo name (used automatically in GitHub Actions)
- `/` fallback for local development
