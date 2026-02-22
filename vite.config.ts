import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();

  if (!trimmed || trimmed === '/') {
    return '/';
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const envBase = env.BASE_URL || process.env.BASE_URL;
  const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];

  const base = envBase
    ? normalizeBasePath(envBase)
    : repoName
      ? normalizeBasePath(repoName)
      : '/';

  return {
    plugins: [react()],
    base
  };
});
