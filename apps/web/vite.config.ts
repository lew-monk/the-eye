import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start'
import viteReact from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tanstackStart(),
    // react's vite plugin must come after start's vite plugin
    viteReact(),
  ],
  server: {
    port: 3000,
    host: '0.0.0.0', // Bind to all interfaces for Docker
  },
})
