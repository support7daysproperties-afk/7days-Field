import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mkcert()],
  server: {
    host: '0.0.0.0'
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
  esbuild: {
    keepNames: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
})
