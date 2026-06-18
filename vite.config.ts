import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const browserTarget = process.env.BROWSER_TARGET === 'firefox' ? 'firefox' : 'chrome'
const manifestFile = browserTarget === 'firefox' ? 'manifest.firefox.json' : 'manifest.json'

/**
 * Returns the extra host permission needed when the extension is pointed at a
 * non-production API base URL (local end-to-end testing). Production builds
 * (no override, or echtstern.de) get no extra permission.
 */
const devApiHostPermission = (): string | null => {
  const apiBaseUrl = process.env.VITE_ECHTSTERN_API_BASE_URL
  if (!apiBaseUrl) {
    return null
  }

  try {
    const { origin } = new URL(apiBaseUrl)
    return origin.includes('echtstern.de') ? null : `${origin}/*`
  } catch {
    return null
  }
}

const copyManifest = (): Plugin => ({
  name: 'copy-extension-manifest',
  closeBundle() {
    const source = resolve(import.meta.dirname, manifestFile)
    const destination = resolve(import.meta.dirname, 'dist/manifest.json')
    const hostPermission = devApiHostPermission()

    if (!hostPermission) {
      copyFileSync(source, destination)
      return
    }

    const manifest = JSON.parse(readFileSync(source, 'utf8')) as {
      host_permissions?: string[]
    }
    manifest.host_permissions = Array.from(
      new Set([...(manifest.host_permissions ?? []), hostPermission]),
    )
    writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`)
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
