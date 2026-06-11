import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/procity/' : '/',
  test: {
    environment: 'node',
    globals: true,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@babylonjs')) {
            return 'babylon'
          }
        },
      },
    },
  },
})
