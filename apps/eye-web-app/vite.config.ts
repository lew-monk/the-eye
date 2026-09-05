import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const config = defineConfig({
  // Root .env has COREF_SERVICE_TOKEN / API_URL used by the file-proxy server route
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '@workspace/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@workspace/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  ssr: {
    noExternal: ['three', '@react-three/fiber', '@react-three/drei'],
  },
  plugins: [
    tsconfigPaths(),
    devtools({
      injectSource: {
        enabled: true,
        ignore: {
          // R3F treats data-* as nested Three.js props (data.tsd-source),
          // which throws on click: Cannot set "data-tsd-source".
          files: ['**/graph-world.tsx', '**/iso-network.tsx'],
          components: [
            'mesh',
            'group',
            'color',
            'fog',
            'ambientLight',
            'directionalLight',
            'pointLight',
            'gridHelper',
            'lineSegments',
            'Canvas',
            'Html',
            'Line',
            'OrbitControls',
            'RoundedBox',
            /Geometry$/,
          ],
        },
      },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
})

export default config
