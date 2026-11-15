import { defineConfig } from 'vite';

export default defineConfig({
  // Local development uses /. GitHub Actions sets this to the repository path.
  base: process.env.VITE_BASE_PATH || '/'
});
