import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://localhost:4001', changeOrigin: true },
      '/diagnostics': { target: 'http://localhost:4001', changeOrigin: true },
      '/healthz': { target: 'http://localhost:4001', changeOrigin: true },
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: false,
  },
});
