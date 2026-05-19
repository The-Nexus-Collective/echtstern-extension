import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/background/background.ts'),
      name: 'ECHTSTERNBackground',
      formats: ['iife'],
      fileName: () => 'assets/background.js',
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
})
