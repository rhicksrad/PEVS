# ECC Scheduler Calendar (Vite + React + TypeScript)

This is an integrated scheduling app (no separate PDF image viewer) that starts with a structured February 2026 ECC schedule and supports ongoing updates directly in the UI.

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

## What is implemented

- Interactive monthly calendar with shift + teaching + admin events.
- Seeded recurring schedule based on the extracted structure:
  - Day Shift at 08:00 (daily in Feb 2026)
  - Late Shift at 14:00 (weekday cadence)
  - Teaching/case blocks at 13:30 (set of recurring topic sessions)
  - Additional non-shift obligations (resident review, journal club, grading, retreat, rounds, etc.)
- Day detail panel listing all events for the selected date.
- Role/legend context included in app UI:
  - ECC Resident Chief
  - ECC Teaching
  - General ECC Service
- Built-in command input for quick schedule changes:
  - `add <title> on YYYY-MM-DD at HH:MM [shift|teaching|admin|milestone]`
  - `remove <title> on YYYY-MM-DD`
- Local persistence via browser `localStorage` for future scheduling edits.

## Deployment base path

This project supports GitHub Pages subpath deployment through `vite.config.ts`.

Base path selection order:
- `BASE_URL` environment variable (recommended)
- `GITHUB_REPOSITORY` repo name (used automatically in GitHub Actions)
- `/` fallback for local development
