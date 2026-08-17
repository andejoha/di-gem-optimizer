import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The path the app is served from. Defaults to root; override with VITE_BASE
  // when building for a host that serves the app from a subpath.
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
});
