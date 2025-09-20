import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,           // Vite dev server port
    strictPort: true,     // fail if port is in use
  },
})
