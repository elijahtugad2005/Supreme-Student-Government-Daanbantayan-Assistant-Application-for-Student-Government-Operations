import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/Prototype-SSG-Office-Assistant-App/',
  // Telegram settings do not use the VITE_ prefix, so allow them through too.
  envPrefix: ['VITE_', 'TELEGRAM_'],
  build: {
    modulePreload: false,
  }
})
