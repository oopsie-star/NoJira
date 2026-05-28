import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_APP_BASE_URL ?? '/',
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: { target: 'es2020' },
  server: { port: 5173 },
})
