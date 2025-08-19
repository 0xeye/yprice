import { defineConfig } from 'vite';
import vercel from 'vite-plugin-vercel';
import path from 'path';

export default defineConfig({
  plugins: [vercel()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});