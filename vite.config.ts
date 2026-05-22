import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const browserTarget = process.env.BROWSER_TARGET === 'firefox' ? 'firefox' : 'chrome'
const manifestFile = browserTarget === 'firefox' ? 'manifest.firefox.json' : 'manifest.json'

const copyManifest = (): Plugin => ({
  name: 'copy-extension-manifest',
  closeBundle() {
    copyFileSync(
      resolve(import.meta.dirname, manifestFile),
      resolve(import.meta.dirname, 'dist/manifest.json'),
    )
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
