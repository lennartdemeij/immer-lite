import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function resolveBase(command: string): string {
  if (command !== 'build') {
    return '/';
  }

  const explicitBase = process.env.VITE_BASE_PATH;
  if (explicitBase) {
    return explicitBase.endsWith('/') ? explicitBase : `${explicitBase}/`;
  }

  const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];
  if (repository) {
    return `/${repository}/`;
  }

  return '/';
}

export default defineConfig(({ command }) => ({
  base: resolveBase(command),
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts'
  }
}));
