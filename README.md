# Shift Scheduler Calendar (Vite + React + TypeScript)

This app now reads and displays the schedule PDF directly in-browser, then performs lightweight PDF text extraction to populate the calendar with real per-day placeholder coverage entries.

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

## Schedule PDF parity (current step)

The schedule source-of-truth PDF is committed under `public/`:

- `public/purdue-e-cc-schedule-2026-02-22-20-34-50.pdf`

Because it is in `public/`, Vite serves it as a static asset in both local dev and GitHub Pages builds. The app references it via:

- `import.meta.env.BASE_URL + 'purdue-e-cc-schedule-2026-02-22-20-34-50.pdf'`

So it works for root (`/`) and project subpath deployments.

### What is implemented

- Two-pane desktop layout (calendar/details + PDF viewer).
- Mobile layout stacks calendar on top and PDF viewer below.
- PDF viewer (PDF.js):
  - Previous/next page
  - Zoom in/out
  - Fit-width toggle
  - Scrollable multi-page rendering
- Calendar integration with parsed PDF output:
  - Days with parsed entries get a dot marker
  - Selecting a day shows parsed entries (raw text retained)
  - Selecting a day attempts a best-effort jump to a page containing that date
- Parsing module (`src/lib/pdfSchedule.ts`) provides:
  - `loadPdf(url)`
  - `extractPagesText(pdf)`
  - `parseSchedule(pagesText)`

The parser is intentionally heuristic and keeps raw text segments for future refinement.

## GitHub Pages base path

This project supports GitHub Pages subpath deployment through `vite.config.ts`.

Base path selection order:
- `BASE_URL` environment variable (recommended)
- `GITHUB_REPOSITORY` repo name (used automatically in GitHub Actions)
- `/` fallback for local development

The GitHub Actions workflow also detects `*.github.io` repositories and builds with `/` as the base path, so both project Pages (`/<repo>/`) and user/org Pages (`/`) deploy correctly.

Examples:

```bash
BASE_URL=my-repo pnpm build
```

or include slashes if you prefer:

```bash
BASE_URL=/my-repo/ pnpm build
```

## Enable deployment with GitHub Actions

1. Push this repository to GitHub.
2. In GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Ensure your default branch is `main`.
5. Push to `main` to trigger `.github/workflows/deploy.yml`.

The workflow installs with pnpm, builds to `dist`, uploads the Pages artifact, and deploys it.
