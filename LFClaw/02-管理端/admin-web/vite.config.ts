import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: 'dist',
    emptyOutDir: false,
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      {
        find: '@deepseek-ai/dsh-client-ui-theme',
        replacement: path.resolve(__dirname, '../../../packages/client/ui-theme/src'),
      },
    ],
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: { '/lfclaw/api': process.env.LFCLAW_DSH_URL ?? 'http://127.0.0.1:39811' },
  },
  preview: {
    port: 4173,
    host: '127.0.0.1',
  },
})
