import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5101,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5100',
        changeOrigin: true,
        secure: false
      },
      '/ws': {
        target: 'ws://localhost:5100',
        ws: true,
        changeOrigin: true
      }
    }
  },
  preview: {
    port: 5101,
    host: true,
    allowedHosts: ['agenda.bpsmalut.com', 'localhost', '127.0.0.1']
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // #18: split vendor libs out of the app bundle so a page change doesn't bust
    // the cache for every import. The groupings below are chosen by observed size:
    // react/react-dom ship together; editor/dnd libs are heavy and page-specific.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          icons: ['react-icons/hi'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          axios: ['axios'],
          dayjs: ['dayjs'],
        }
      }
    }
  }
})
