import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const copyManifest = (): Plugin => ({
  name: 'copy-extension-manifest',
  closeBundle() {
    copyFileSync(resolve(import.meta.dirname, 'manifest.json'), resolve(import.meta.dirname, 'dist/manifest.json'))
  },
})

export default defineConfig({
  plugins: [react(), copyManifest()],
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'popup.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
