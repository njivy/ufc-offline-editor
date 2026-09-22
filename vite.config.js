import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: 'index.html',
      output: {
        format: 'iife',
        name: 'UfcOfflineEditor',
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
