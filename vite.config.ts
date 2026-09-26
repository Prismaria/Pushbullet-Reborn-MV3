import { fileURLToPath } from 'node:url'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ mode }) => {
  const classic = mode === 'classic'

  return {
  base: './',
  plugins: [react(), {
    name: 'exclude-classic-assets-from-reborn',
    async closeBundle() {
       if (!classic) {
         await rm(resolve(projectRoot, 'dist-reborn/classic-pages'), { recursive: true, force: true })
         await rm(resolve(projectRoot, 'dist-reborn/classic-assets'), { recursive: true, force: true })
       }
    }
  }],
  build: {
    outDir: classic ? 'dist-classic' : 'dist-reborn',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        ...(classic ? {
           panel: resolve(projectRoot, 'classic-pages/panel.html'),
           options: resolve(projectRoot, 'classic-pages/options.html'),
           'chat-window': resolve(projectRoot, 'classic-pages/chat-window.html'),
           welcome: resolve(projectRoot, 'classic-pages/welcome.html'),
           offscreen: resolve(projectRoot, 'offscreen.html')
        } : {
          popup: resolve(projectRoot, 'popup.html'),
          options: resolve(projectRoot, 'options.html'),
          chat: resolve(projectRoot, 'chat.html'),
          offscreen: resolve(projectRoot, 'offscreen.html')
        }),
        background: resolve(projectRoot, 'src/background.ts')
      },
      output: {
        entryFileNames: (chunk) => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
  }
})
