# Shift Scheduler Calendar (Vite + React + TypeScript)

Simple month-view calendar scaffold for planning work shifts for 5 people.

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
