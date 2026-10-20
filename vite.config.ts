import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/sql-console/',
  plugins: [react()],
  build: {
    // Monaco's editor core is one chunk. The SQL grammar is loaded separately.
    chunkSizeWarningLimit: 4500,
  },
})
