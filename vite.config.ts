import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['PORT', 'API_PROXY_TARGET']);
  const apiTarget = process.env.API_PROXY_TARGET || env.API_PROXY_TARGET || `http://localhost:${process.env.PORT || env.PORT || 3001}`;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': apiTarget,
      },
    },
  };
});