import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
export default defineConfig(({ mode }) => {
  // Source maps are uploaded only when a build-time Sentry token is present; the demo build stays offline without one.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const upload = Boolean(env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT);
  return {
    plugins: [react(), ...(upload ? [sentryVitePlugin({ org: env.SENTRY_ORG, project: env.SENTRY_PROJECT, authToken: env.SENTRY_AUTH_TOKEN, sourcemaps: { filesToDeleteAfterUpload: ['dist/web/**/*.map'] } })] : [])],
    build: { outDir: 'dist/web', sourcemap: upload ? 'hidden' : false },
    server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  };
});
