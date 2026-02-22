import { defineConfig, loadEnv, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();

  if (!trimmed || trimmed === '/') {
    return '/';
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
}

function teamupProxyPlugin(): PluginOption {
  return {
    name: 'teamup-local-proxy',
    configureServer(server) {
      server.middlewares.use('/api/teamup', async (req, res) => {
        try {
          const upstreamPath = req.url ?? '/';
          const upstreamUrl = `https://ics.teamup.com${upstreamPath}`;
          const { stdout } = await execFileAsync('curl', ['-sS', '-L', upstreamUrl], {
            maxBuffer: 10 * 1024 * 1024
          });

          res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
          res.statusCode = 200;
          res.end(stdout);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to proxy Teamup ICS feed.';
          res.statusCode = 502;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(message);
        }
      });
    }
  };
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
    plugins: [react(), teamupProxyPlugin()],
    base
  };
});
